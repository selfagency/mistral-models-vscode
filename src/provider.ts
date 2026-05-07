import { toMistralMessages as adaptersToMistralMessages, processRawStream } from '@agentsy/adapters';
import { normalizeMistralChunk } from '@agentsy/normalizers';
import type { OutputPart } from '@agentsy/processor';
import { extractXmlToolCalls } from '@agentsy/tool-calls';
import {
  accumulateToolCallDeltas,
  cancellationTokenToAbortSignal,
  createVSCodeAgentLoop,
  createVSCodeChatRenderer,
  mapUsageToVSCode,
  ToolCallDeltaAccumulator,
  toVSCodeToolCallPart,
} from '@agentsy/vscode';
import type { XmlStreamFilter } from '@agentsy/xml-filter';
import { createXmlStreamFilter } from '@agentsy/xml-filter';
import { Mistral } from '@mistralai/mistralai';
import type { Span, Tracer } from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';
import type { Tiktoken } from 'tiktoken';
import { get_encoding } from 'tiktoken';
import type {
  CancellationToken,
  ChatResponseStream,
  Event,
  ExtensionContext,
  LanguageModelChatInformation,
  LanguageModelChatProvider,
  LanguageModelChatRequestMessage,
  LanguageModelResponsePart,
  LogOutputChannel,
  Progress,
  ProvideLanguageModelChatResponseOptions,
} from 'vscode';
import {
  EventEmitter,
  LanguageModelChatMessageRole,
  LanguageModelChatToolMode,
  LanguageModelDataPart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  window,
  workspace,
} from 'vscode';

// Added isAsyncIterable, toAsyncIterable for async iterable fix
function isAsyncIterable<T>(obj: unknown): obj is AsyncIterable<T> {
  return obj !== null && typeof obj === 'object' && Symbol.asyncIterator in obj;
}

function toAsyncIterable<T>(iterable: Iterable<T>): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of iterable) {
        yield item;
      }
    },
  };
}

interface AgentsyChatResponseStreamCompat {
  markdown(content: string): void;
  progress(content: string): void;
  anchor(value: unknown, title?: string): void;
  reference(value: unknown, iconPath?: unknown): void;
  button(command: { command: string; title: string; arguments?: unknown[] }): void;
  filetree(value: Array<{ name: string; children?: unknown[] }>, baseUri: unknown): void;
}

/**
 * Mistral model configuration
 */
export interface MistralModel {
  id: string;
  name: string;
  detail?: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  defaultCompletionTokens: number;
  toolCalling: boolean;
  supportsParallelToolCalls: boolean;
  supportsVision?: boolean;
  temperature?: number;
  top_p?: number;
}

// Default completion tokens for rate limiting optimization
const DEFAULT_COMPLETION_TOKENS = 65536;
const DEFAULT_MAX_OUTPUT_TOKENS = 32768;

/**
 * Per-model output token limits
 * Fetched from Mistral API documentation and capabilities
 */
const MODEL_OUTPUT_LIMITS: Record<string, number> = {
  'mistral-large-latest': 32768,
  'codestral-latest': 32768,
  'mistral-medium-latest': 8192,
  'mistral-small-latest': 4096,
  'pixtral-large-latest': 8192,
  'magistral-medium-latest': 8192,
  'magistral-small-latest': 4096,
};

/**
 * Get model-specific output token limit with fallback to default
 */
function getModelOutputLimit(modelId: string): number {
  if (modelId in MODEL_OUTPUT_LIMITS) {
    return MODEL_OUTPUT_LIMITS[modelId];
  }
  return DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Prettify a model ID into a display name when the API doesn't provide one.
 * e.g. "mistral-large-latest" → "Mistral Large Latest"
 */
export function formatModelName(id: string): string {
  return id
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Get chat model information for VS Code Language Model API
 */
export function getChatModelInfo(model: MistralModel): LanguageModelChatInformation {
  return {
    id: model.id,
    name: model.name,
    // Intentionally omit tooltip: VS Code uses it as the picker description in the
    // chat window, overriding the detail field. Without it, detail: 'Mistral AI' is
    // shown correctly alongside the model name in both the chat window and manage models view.
    family: 'mistral',
    // Short, consistent description shown alongside the model in the chat window
    // and manage models dropdown.
    detail: 'Mistral AI',
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    version: model.id,
    capabilities: {
      toolCalling: model.toolCalling,
      imageInput: model.supportsVision ?? false,
    },
  };
}

/**
 * Message types for Mistral API
 */
export type MistralContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; imageUrl: string }>;

export type MistralToolCall = {
  id: string;
  index?: number;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type MistralRole = 'system' | 'user' | 'assistant' | 'tool';
export type MistralOutboundRole = 'system' | 'user' | 'assistant';

export interface MistralSystemMessage {
  role: 'system';
  content: string;
}
export interface MistralUserMessage {
  role: 'user';
  content: MistralContent;
}
export interface MistralAssistantMessage {
  role: 'assistant';
  content: MistralContent | null;
  toolCalls?: MistralToolCall[];
  prefix?: boolean;
}
export interface MistralToolMessage {
  role: 'tool';
  content: string | null;
  toolCallId: string;
  name?: string;
}

export type MistralMessage = MistralSystemMessage | MistralUserMessage | MistralAssistantMessage | MistralToolMessage;

type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: Uint8Array }
  | { type: 'tool-call'; callId: string; name: string; input?: Record<string, unknown> }
  | { type: 'tool-result'; callId: string; content: string };

/**
 * Mistral Chat Model Provider
 * Implements VS Code's LanguageModelChatProvider interface for GitHub Copilot Chat
 */
/**
 * Response classification for error handling and retry logic
 * Matches vscode-copilot-chat response type patterns
 */
enum ChatFetchResponseType {
  Success = 0,
  Failed = 1,
  RateLimited = 2,
  QuotaExceeded = 3,
  Canceled = 4,
}

/**
 * Classify error into response type for retry eligibility
 */
function classifyResponse(error: unknown, token?: CancellationToken): ChatFetchResponseType {
  if (token?.isCancellationRequested) return ChatFetchResponseType.Canceled;

  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage.toLowerCase();

  const mapping: Array<{ substrings: string[]; type: ChatFetchResponseType }> = [
    { substrings: ['402', '413'], type: ChatFetchResponseType.QuotaExceeded },
    { substrings: ['429', 'rate limit'], type: ChatFetchResponseType.RateLimited },
    { substrings: ['401', 'unauthorized', '403', 'forbidden'], type: ChatFetchResponseType.Failed },
    { substrings: ['500', 'internal server', '502', '503'], type: ChatFetchResponseType.Failed },
    { substrings: ['network', 'econnrefused', 'etimedout'], type: ChatFetchResponseType.Failed },
  ];

  for (const map of mapping) {
    for (const sub of map.substrings) {
      if (message.includes(sub)) return map.type;
    }
  }

  return ChatFetchResponseType.Failed;
}

/**
 * Retry wrapper with exponential backoff and Retry-After header support
 * Never retries rate limit, quota exceeded, or auth errors
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  token: CancellationToken,
  context: string,
  log: LogOutputChannel,
  maxRetries = 3,
): Promise<T> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      const responseType = classifyResponse(error, token);

      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = rawMessage.toLowerCase();
      const isRetryableTransient =
        message.includes('500') ||
        message.includes('internal server') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('network') ||
        message.includes('econnrefused') ||
        message.includes('etimedout');

      // Never retry cancellation, rate limit, quota, auth/access, or non-transient errors.
      if (
        responseType === ChatFetchResponseType.Canceled ||
        responseType === ChatFetchResponseType.RateLimited ||
        responseType === ChatFetchResponseType.QuotaExceeded ||
        !isRetryableTransient
      ) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30000); // 1s, 2s, 4s, capped at 30s

      log.info(`[Mistral] ${context} attempt ${attempt} failed, retrying in ${delay}ms: ${String(error)}`);
      await new Promise(resolve => setTimeout(resolve, delay));

      if (token.isCancellationRequested) throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * Map error objects to user-friendly messages
 */
function getUserFriendlyError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage.toLowerCase();
  if (message.includes('401') || message.includes('unauthorized')) {
    return 'Invalid or expired API key. Please update it via "Mistral: Manage API Key".';
  }
  if (message.includes('403') || message.includes('forbidden')) {
    return 'API key does not have permission for this operation. Please check your key.';
  }
  if (message.includes('429') || message.includes('rate limit')) {
    return 'Rate limit exceeded. Please try again in a moment.';
  }
  if (message.includes('500') || message.includes('internal server')) {
    return 'Mistral service is temporarily unavailable. Please try again later.';
  }
  if (message.includes('network') || message.includes('econnrefused')) {
    return 'Network error. Please check your connection and try again.';
  }
  return 'An error occurred. Please try again or check your API key.';
}

export class MistralChatModelProvider implements LanguageModelChatProvider {
  private client: Mistral | null = null;
  private tokenizer: Tiktoken | null = null;
  private fetchedModels: MistralModel[] | null = null;
  private modelsCacheExpiry: number = 0;
  private readonly MODELS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private initPromise?: Promise<boolean>;
  // Mapping from VS Code tool call IDs to Mistral tool call IDs
  private toolCallIdMapping = new Map<string, string>();
  // Mapping from Mistral tool call IDs to VS Code tool call IDs
  private reverseToolCallIdMapping = new Map<string, string>();
  private readonly log: LogOutputChannel;
  private readonly tracer: Tracer = trace.getTracerProvider().getTracer('mistral-vscode');
  private activeToolNames = new Set<string>();
  private apiKeyManager:
    | {
        initialize(): Promise<void>;
        getApiKey(): Promise<string | undefined>;
        setApiKey(key?: string): Promise<void>;
        onDidChangeApiKey(listener: (event: string, newKey: string | undefined) => void): void;
        setupHasKeyContext?: () => Promise<void>;
      }
    | undefined;
  private apiKeyManagerInitPromise: Promise<void> | undefined;
  // Event emitter for notifying VS Code when models change
  private readonly _onDidChangeLanguageModelChatInformation = new EventEmitter<void>();

  /**
   * Event fired when the available set of language models changes.
   */
  readonly onDidChangeLanguageModelChatInformation: Event<void> = this._onDidChangeLanguageModelChatInformation.event;

  constructor(
    private readonly context: ExtensionContext,
    logOutputChannel?: LogOutputChannel,
    // When true, attempt interactive initialization on construction (activation).
    // Default is false to avoid prompting during unit tests which instantiate the provider.
    autoInit: boolean = false,
  ) {
    // Accept an optional logOutputChannel to keep tests simple. Provide a no-op fallback when not available.
    if (logOutputChannel) {
      this.log = logOutputChannel;
    } else {
      // Minimal no-op logger matching LogOutputChannel methods used here.
      // Cast via unknown to satisfy the LogOutputChannel type without using `any`.
      this.log = {
        info: () => {},
        debug: () => {},
        warn: () => {},
        error: () => {},
        appendLine: () => {},
        dispose: () => {},
      } as unknown as LogOutputChannel;
    }
    this.log.info('[Mistral] Provider constructed');
    if (autoInit) {
      this.log.info('[Mistral] Auto-initializing client on activation');
      // Start initialization and remember the promise so incoming queries can await it.
      this.initPromise = this.initClient(true);
      // Do not await here (activation should not be blocked); consumers will await initPromise.
    }
  }

  /**
   * Generate a valid VS Code tool call ID (alphanumeric, exactly 9 characters)
   */
  public generateToolCallId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const values = new Uint32Array(9);
    globalThis.crypto.getRandomValues(values);
    let id = '';
    for (let i = 0; i < 9; i++) {
      id += chars[values[i] % chars.length];
    }
    return id;
  }

  /**
   * Get or create a VS Code-compatible tool call ID from a Mistral tool call ID
   */
  public getOrCreateVsCodeToolCallId(mistralId: string): string {
    // Check if we already have a mapping for this Mistral ID
    if (this.reverseToolCallIdMapping.has(mistralId)) {
      const existing = this.reverseToolCallIdMapping.get(mistralId);
      if (existing) return existing;
    }
    // Create a new mapping
    const vsCodeId = this.generateToolCallId();
    this.toolCallIdMapping.set(vsCodeId, mistralId);
    this.reverseToolCallIdMapping.set(mistralId, vsCodeId);
    return vsCodeId;
  }

  /**
   * Get the original Mistral tool call ID from a VS Code tool call ID
   */
  public getMistralToolCallId(vsCodeId: string): string | undefined {
    return this.toolCallIdMapping.get(vsCodeId);
  }

  /**
   * Return the active Mistral client for direct streaming use-cases.
   */
  public getClient(): Mistral | null {
    return this.client;
  }

  /**
   * Initialize and memoize ApiKeyManager from @agentsy/vscode.
   */
  private async getApiKeyManager(): Promise<{
    initialize(): Promise<void>;
    getApiKey(): Promise<string | undefined>;
    setApiKey(key?: string): Promise<void>;
    onDidChangeApiKey(listener: (event: string, newKey: string | undefined) => void): void;
    setupHasKeyContext?: () => Promise<void>;
  }> {
    if (this.apiKeyManager) {
      return this.apiKeyManager;
    }

    if (!this.apiKeyManagerInitPromise) {
      this.apiKeyManagerInitPromise = (async () => {
        const { ApiKeyManager } = await import('@agentsy/vscode');
        const manager = new ApiKeyManager(this.context, {
          secretKey: 'MISTRAL_API_KEY',
          contextKey: 'mistral.hasApiKey',
          displayName: 'Mistral API Key',
          promptMessage: 'Enter your Mistral API key (get one at https://console.mistral.ai/)',
        });

        await manager.initialize();
        try {
          await manager.setupHasKeyContext?.();
        } catch (error) {
          this.log.debug(`[Mistral] setupHasKeyContext failed: ${String(error)}`);
        }

        manager.onDidChangeApiKey((_event, newKey) => {
          this.client = newKey ? new Mistral({ apiKey: newKey }) : null;
          this.fetchedModels = undefined;
          this.modelsCacheExpiry = 0;
          this._onDidChangeLanguageModelChatInformation.fire(undefined);
        });

        this.apiKeyManager = manager;
      })();
    }

    await this.apiKeyManagerInitPromise;
    if (!this.apiKeyManager) {
      throw new Error('Failed to initialize API key manager');
    }
    return this.apiKeyManager;
  }

  /**
   * Check if the models cache has expired
   */
  private isCacheExpired(): boolean {
    return Date.now() > this.modelsCacheExpiry;
  }

  /**
   * Fetch available chat models from the Mistral API and cache the result.
   * Returns an empty array if the client is not initialized or the request fails.
   */
  public async fetchModels(): Promise<MistralModel[]> {
    if (this.fetchedModels !== null && !this.isCacheExpired()) {
      return this.fetchedModels;
    }

    if (!this.client) {
      return [];
    }

    try {
      const response = await this.client.models.list();
      const byId = new Map<string, Record<string, unknown>>();
      for (const m of response.data ?? []) {
        if (!m || typeof m !== 'object') continue;
        const obj = m;
        if (!('id' in obj) || !obj.id || typeof obj.id !== 'string') continue;
        if (!('capabilities' in obj) || !(obj.capabilities as Record<string, unknown>)?.completionChat) continue;
        const id = obj.id;
        if (!byId.has(id)) byId.set(id, obj);
      }

      const rawModels = Array.from(byId.values()).map(obj => {
        const id = obj.id;
        const capabilities = obj.capabilities as Record<string, unknown> | undefined;
        return {
          id,
          originalName: (typeof obj.name === 'string' && obj.name) || formatModelName(id),
          detail: typeof obj.description === 'string' ? obj.description : undefined,
          maxInputTokens: typeof obj.maxContextLength === 'number' ? obj.maxContextLength : 32768,
          maxOutputTokens: getModelOutputLimit(id),
          defaultCompletionTokens: DEFAULT_COMPLETION_TOKENS,
          toolCalling: !!capabilities?.functionCalling,
          supportsParallelToolCalls: !!capabilities?.functionCalling,
          supportsVision: !!capabilities?.vision,
          temperature: typeof obj.defaultModelTemperature === 'number' ? obj.defaultModelTemperature : undefined,
        };
      });

      // Prefer the 'latest' variant within each model family when available.
      // Determine a base id by stripping a trailing '-latest' or numeric suffix (e.g. '-2512').
      const baseFor = (id: string) => id.replace(/-(?:latest|\d+)$/i, '');

      const groups = new Map<string, (typeof rawModels)[number][]>();
      for (const rm of rawModels) {
        const base = baseFor(rm.id);
        const arr = groups.get(base) ?? [];
        arr.push(rm);
        groups.set(base, arr);
      }

      const modelsToUse: (typeof rawModels)[number][] = [];
      for (const [, arr] of groups) {
        // Prefer an explicit 'latest' id if present
        const latest = arr.find(rm => /latest/i.test(rm.id));
        if (latest) {
          modelsToUse.push(latest);
          continue;
        }
        // Otherwise pick the variant with the largest context size as a sensible default
        let best = arr[0];
        for (const cand of arr) {
          if ((cand.maxInputTokens ?? 0) > (best.maxInputTokens ?? 0)) {
            best = cand;
          }
        }
        modelsToUse.push(best);
      }

      // Detect ambiguous (duplicate) display names and append the model id when needed.
      const nameCounts = new Map<string, number>();
      for (const rm of modelsToUse) {
        const n = rm.originalName;
        nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
      }

      // Map API detail through as the model.detail — we will override the
      // UI-visible `detail` in getChatModelInfo to show a short label while
      // preserving the original description on the model object itself.
      this.fetchedModels = modelsToUse.map(rm => ({
        id: rm.id,
        name: nameCounts.get(rm.originalName)! > 1 ? `${rm.originalName} (${rm.id})` : rm.originalName,
        detail: rm.detail,
        maxInputTokens: rm.maxInputTokens,
        maxOutputTokens: rm.maxOutputTokens,
        defaultCompletionTokens: rm.defaultCompletionTokens,
        toolCalling: rm.toolCalling,
        supportsParallelToolCalls: rm.supportsParallelToolCalls,
        supportsVision: rm.supportsVision,
        temperature: rm.temperature,
      }));
      // Notify VS Code that models are available
      this.modelsCacheExpiry = Date.now() + this.MODELS_CACHE_TTL_MS;
      this._onDidChangeLanguageModelChatInformation.fire(undefined);
      return this.fetchedModels;
    } catch (error) {
      this.log.error(`[Mistral] Failed to fetch Mistral models: ${String(error)}`);
      return [];
    }
  }

  /**
   * Clear tool call ID mappings (call at the start of each chat request)
   */
  public clearToolCallIdMappings(): void {
    this.toolCallIdMapping.clear();
    this.reverseToolCallIdMapping.clear();
    this.log.debug('[Mistral] Cleared tool call ID mappings');
  }

  /**
   * Prompts the user to enter their Mistral API key and stores it securely.
   * @returns A promise that resolves to the entered API key if valid, or undefined if cancelled
   */
  public async setApiKey(): Promise<string | undefined> {
    const manager = await this.getApiKeyManager();
    const before = await manager.getApiKey();
    this.log.debug(`[Mistral] Prompting user for API key (existing present: ${!!before})`);

    const input = await window.showInputBox({
      placeHolder: 'Mistral API Key',
      password: true,
      value: before || '',
      prompt: 'Enter your Mistral API key (get one at https://console.mistral.ai/)',
      ignoreFocusOut: true,
    });

    if (!input) {
      this.log.info('[Mistral] setApiKey canceled by user');
      return undefined;
    }

    const apiKey = input.trim();
    if (!apiKey) {
      this.log.info('[Mistral] setApiKey received empty input after trim');
      return undefined;
    }

    let after: string | undefined;
    try {
      await manager.setApiKey(apiKey);
      after = await manager.getApiKey();
    } catch (error) {
      this.log.warn(`[Mistral] Failed to store API key in secret storage: ${String(error)}`);
      this.client = new Mistral({ apiKey });
      this.fetchedModels ??= null;
      this.modelsCacheExpiry = 0;
      this._onDidChangeLanguageModelChatInformation.fire(undefined);
      return apiKey;
    }

    if (!after) {
      return undefined;
    }

    if (after !== before) {
      this.log.info('[Mistral] API key updated');
    }
    if (!this.client) {
      this.client = new Mistral({ apiKey: after });
    }
    return after;
  }

  /**
   * Initialize the Mistral client.
   * @param silent Whether to initialize silently without prompting for API key
   * @returns Whether the initialization was successful
   */
  private async initClient(silent: boolean): Promise<boolean> {
    if (this.client) {
      return true;
    }

    const manager = await this.getApiKeyManager();
    let apiKey: string | undefined = await manager.getApiKey();
    this.log.debug(`[Mistral] initClient called (silent=${silent}, hasStoredKey=${!!apiKey})`);
    if (!silent && !apiKey) {
      apiKey = await this.setApiKey();
    } else if (apiKey) {
      this.client = new Mistral({
        apiKey: apiKey,
      });
    }

    this.log.debug(`[Mistral] initClient result: ${!!apiKey}`);
    return !!apiKey;
  }

  /**
   * Provide available chat model information
   */
  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    this.log.info(`[Mistral] provideLanguageModelChatInformation called (silent=${options.silent})`);
    if (token.isCancellationRequested) {
      this.log.info('[Mistral] provideLanguageModelChatInformation cancelled before initialization');
      return [];
    }
    // If an activation-triggered init is in-flight, wait for it to finish before proceeding.
    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch {
        // ignore — initClient logs errors
      }
      this.initPromise = undefined;
    }

    const initialized = await this.initClient(options.silent);
    if (!initialized) {
      this.log.warn('[Mistral] client not initialized');
      return [];
    }
    if (token.isCancellationRequested) {
      this.log.info('[Mistral] provideLanguageModelChatInformation cancelled after initialization');
      return [];
    }

    const models = await this.fetchModels();
    if (token.isCancellationRequested) {
      this.log.info('[Mistral] provideLanguageModelChatInformation cancelled after fetch');
      return [];
    }
    this.log.info(`[Mistral] Returning ${models.length} models`);
    return models.map(model => getChatModelInfo(model));
  }

  /**
   * Provide chat response from Mistral
   */
  async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<void> {
    this.log.info(
      `[Mistral] provideLanguageModelChatResponse start for model=${model.id}, messages=${messages.length}`,
    );
    // Clear tool call ID mappings for this new request
    this.clearToolCallIdMappings();

    // Check if client is initialized
    if (!this.client) {
      progress.report(new LanguageModelTextPart('Please add your Mistral API key to use Mistral AI.'));
      return;
    }

    if (token.isCancellationRequested) {
      progress.report(new LanguageModelTextPart('Request cancelled.'));
      return;
    }

    // Find the model in our fetched list to get capability details
    const models = await this.fetchModels();
    const foundModel = models.find(m => m.id === model.id) ?? {
      id: model.id,
      name: model.name,
      maxInputTokens: model.maxInputTokens,
      maxOutputTokens: getModelOutputLimit(model.id),
      defaultCompletionTokens: DEFAULT_COMPLETION_TOKENS,
      toolCalling: true,
      supportsParallelToolCalls: false,
      supportsVision: false,
    };

    // Validate tool messages and strip orphaned results
    const validation = this.validateToolMessages(messages);
    if (validation.strippedToolCallCount > 0) {
      this.log.warn(
        `[Mistral] Stripped ${validation.strippedToolCallCount} orphaned tool result(s) before sending to API`,
      );
    }

    // Convert VS Code messages to Mistral format.
    const mistralMessages: MistralMessage[] = this.toMistralMessages(validation.valid);

    // Convert VS Code tools to Mistral format
    const mistralTools = options.tools?.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || {},
      },
    }));
    this.activeToolNames = new Set((options.tools ?? []).map(tool => tool.name));

    const shouldSendTools = mistralTools && mistralTools.length > 0;
    const toolChoice = shouldSendTools
      ? options.toolMode === LanguageModelChatToolMode.Required
        ? 'any'
        : 'auto'
      : undefined;
    const parallelToolCalls = shouldSendTools ? (foundModel.supportsParallelToolCalls ?? false) : undefined;

    // Allow VS Code modelOptions to override some request parameters.
    const modelOptions = (options.modelOptions ?? {}) as Record<string, unknown>;
    const temperature =
      typeof modelOptions.temperature === 'number' ? modelOptions.temperature : (foundModel.temperature ?? 0.7);
    const topP = typeof modelOptions.topP === 'number' ? modelOptions.topP : (foundModel.top_p ?? undefined);
    const safePrompt = typeof modelOptions.safePrompt === 'boolean' ? modelOptions.safePrompt : undefined;
    const responseFormat =
      modelOptions.responseFormat && typeof modelOptions.responseFormat === 'object'
        ? modelOptions.responseFormat
        : undefined;
    const randomSeed = typeof modelOptions.randomSeed === 'number' ? modelOptions.randomSeed : undefined;
    const stopSequences = modelOptions.stop;
    const stop =
      Array.isArray(stopSequences) && stopSequences.every(item => typeof item === 'string') ? stopSequences : undefined;
    const presencePenalty = typeof modelOptions.presencePenalty === 'number' ? modelOptions.presencePenalty : undefined;
    const frequencyPenalty =
      typeof modelOptions.frequencyPenalty === 'number' ? modelOptions.frequencyPenalty : undefined;
    const promptMode = modelOptions.promptMode === 'reasoning' ? 'reasoning' : undefined;

    // OpenTelemetry span for request tracking
    const span = this.tracer.startSpan('mistral.chat.completion', {
      attributes: {
        'model.id': model.id,
        'model.family': 'mistral',
      },
    });

    try {
      if (!this.client) throw new Error('Mistral client not initialized');

      const abortSignal = cancellationTokenToAbortSignal(token);

      // Adapter: wrap Progress as AgentsyChatResponseStreamCompat for the renderer
      const rendererStream: AgentsyChatResponseStreamCompat = {
        markdown: (content: string) => progress.report(new LanguageModelTextPart(content)),
        progress: (content: string) => progress.report(new LanguageModelTextPart(content)),
        anchor: () => {}, // Not used for VS Code chat
        reference: () => {}, // Not used for VS Code chat
        button: () => {}, // Not used for VS Code chat
        filetree: () => {}, // Not used for VS Code chat
      };

      const renderer = createVSCodeChatRenderer({ stream: rendererStream });
      const xmlFilter = createXmlStreamFilter({
        onWarning: (message: string, context?: Record<string, unknown>) => {
          const contextStr = context ? ` ${JSON.stringify(context)}` : '';
          this.log.debug(`Mistral xml filter warning: ${message}${contextStr}`);
        },
      });

      // Create chat completion request with streaming (wrapped in retry logic)
      const client = this.client as Mistral;
      const stream = await withRetry(
        async () =>
          client.chat.stream(
            {
              model: model.id,
              messages: mistralMessages,
              maxTokens: Math.min(foundModel.defaultCompletionTokens, foundModel.maxOutputTokens),
              temperature,
              topP,
              safePrompt,
              responseFormat: responseFormat as never,
              randomSeed,
              stop,
              presencePenalty,
              frequencyPenalty,
              promptMode,
              tools: shouldSendTools && foundModel.toolCalling ? mistralTools : undefined,
              toolChoice: shouldSendTools && foundModel.toolCalling ? toolChoice : undefined,
              parallelToolCalls: shouldSendTools && foundModel.toolCalling ? parallelToolCalls : undefined,
            },
            { signal: abortSignal },
          ),
        token,
        'chat.completion',
        this.log,
      );

      const toolCallAccumulator = new ToolCallDeltaAccumulator();

      // Track Time To First Token (TTFT)
      const startTime = Date.now();
      let ttft: number | undefined;

      for await (const output of processRawStream(stream, data => normalizeMistralChunk(data)?.chunk, {
        modelId: model.id,
        accumulateNativeToolCalls: true,
        onWarning: (msg, ctx) => {
          const ctxStr = ctx ? ` ${JSON.stringify(ctx)}` : '';
          this.log.warn(`[Mistral] stream parser: ${msg}${ctxStr}`);
        },
      })) {
        if (token.isCancellationRequested) {
          break;
        }

        if (!ttft && output.parts.some(part => part.type === 'text' && part.text.length > 0)) {
          ttft = Date.now() - startTime;
          this.log.info(`[Mistral] TTFT: ${ttft}ms`);
          span.setAttributes({ 'ttft.ms': ttft });
        }

        if (output.usage) {
          this.log.info(
            `[Mistral] usage input=${output.usage.inputTokens ?? 0} output=${output.usage.outputTokens ?? 0}`,
          );
          span.setAttributes({
            'input.tokens': output.usage.inputTokens,
            'output.tokens': output.usage.outputTokens,
          });
          const mappedUsage = mapUsageToVSCode(output.usage);
          if (mappedUsage) {
            this.log.debug(`Mistral straggler: [tool-call:${mappedCallId} ${xmlToolCall.name}]`);
          }
        }

        this._emitProcessedParts(output.parts, progress, renderer, toolCallAccumulator, xmlFilter);
      }

      const trailingText = xmlFilter.end();
      if (trailingText.length > 0) {
        renderer.markdown(trailingText);
      }

      const completedToolCalls = toolCallAccumulator.finalize({
        repairIncomplete: true,
        onWarning: (msg: string, ctx?: Record<string, unknown>) => {
          const ctxStr = ctx ? ` ${JSON.stringify(ctx)}` : '';
          this.log.warn(`[Mistral] tool call finalize warning: ${msg}${ctxStr}`);
        },
      });
      for (const toolCall of completedToolCalls) {
        this.log.info(`[Mistral] Emitting finalized tool call id=${toolCall.callId} name=${toolCall.name}`);
        progress.report(new LanguageModelToolCallPart(toolCall.callId, toolCall.name, toolCall.input ?? {}));
      }
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || token.isCancellationRequested)) {
        this.log.info('[Mistral] Request cancelled');
        return;
      }
      const errorMessage = getUserFriendlyError(error);
      this.log.error(
        '[Mistral] provideLanguageModelChatResponse error: ' +
          (error instanceof Error ? error.stack || error.message : String(error)),
      );
      progress.report(new LanguageModelTextPart(errorMessage));
    } finally {
      span.end();
    }
  }

  /**
   * Stream a participant response directly from Mistral using @agentsy/vscode renderer.
   */
  private selectModel(modelId: string | undefined, models: MistralModel[]): MistralModel {
    let selected: MistralModel | undefined;
    if (modelId) {
      selected = models.find(model => model.id === modelId);
    }
    if (!selected) {
      selected = models[0];
      this.fetchedModels ??= null;
    }
    if (!selected) {
      selected = {
        id: modelId ?? 'mistral-large-latest',
        name: modelId ?? 'Mistral',
        maxInputTokens: 32768,
        maxOutputTokens: getModelOutputLimit(modelId ?? 'mistral-large-latest'),
        defaultCompletionTokens: DEFAULT_COMPLETION_TOKENS,
        toolCalling: false,
        supportsParallelToolCalls: false,
        supportsVision: false,
      };
    }
    return selected;
  }

  public async streamParticipantResponse(
    modelId: string | undefined,
    messages: readonly LanguageModelChatRequestMessage[],
    stream: ChatResponseStream,
    token: CancellationToken,
  ): Promise<void> {
    this.clearToolCallIdMappings();

    if (token.isCancellationRequested) {
      stream.markdown('Request cancelled.');
      return;
    }

    const initialized = await this.initClient(true);
    if (!initialized || !this.client) {
      stream.markdown('Please add your Mistral API key to use Mistral AI.');
      return;
    }

    const models = await this.fetchModels();
    const selectedModel = this.selectModel(modelId, models);

    // Validate tool messages and strip orphaned results
    const validation = this.validateToolMessages(messages);
    if (validation.strippedToolCallCount > 0) {
      this.log.warn(
        `Mistral participant: Stripped ${validation.strippedToolCallCount} orphaned tool result(s) before sending to API`,
      );
    }

    const mistralMessages: MistralMessage[] = this.toMistralMessages(validation.valid);

    // OpenTelemetry span for participant request tracking
    const span = this.tracer.startSpan('mistral.participant.chat.completion', {
      attributes: {
        'model.id': selectedModel.id,
        'model.family': 'mistral',
      },
    });

    try {
      const renderer = createVSCodeAgentLoop({
        stream: stream as unknown as AgentsyChatResponseStreamCompat,
        thinkingStyle: 'progress',
        abortSignal: cancellationTokenToAbortSignal(token),
      });

      if (!this.client) throw new Error('Mistral client not initialized');

      const client = this.client as Mistral;
      const mistralStream = await withRetry(
        () =>
          client.chat.stream(
            {
              model: selectedModel.id,
              messages: mistralMessages,
              maxTokens: Math.min(selectedModel.defaultCompletionTokens, selectedModel.maxOutputTokens),
              temperature: selectedModel.temperature ?? 0.7,
              topP: selectedModel.top_p,
            },
            { signal: cancellationTokenToAbortSignal(token) },
          ),
        token,
        'participant.chat.completion',
        this.log,
      );

      // Track Time To First Token (TTFT)
      const startTime = Date.now();
      let ttft: number | undefined;

      const asyncIterable = isAsyncIterable(mistralStream) ? mistralStream : toAsyncIterable(mistralStream);
      const ttftResult = await this._consumeParticipantStream(asyncIterable, renderer, token, span, startTime);
      if (!ttft && typeof ttftResult === 'number') {
        ttft = ttftResult;
        this.log.info(`[Mistral] participant TTFT: ${ttft}ms`);
        span.setAttributes({ 'ttft.ms': ttft });
      }
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || token.isCancellationRequested)) {
        this.log.info('[Mistral] Participant request cancelled');
        return;
      }
      this.log.error(
        '[Mistral] streamParticipantResponse error: ' +
          (error instanceof Error ? error.stack || error.message : String(error)),
      );
      stream.markdown(getUserFriendlyError(error));
    } finally {
      span.end();
    }
  }

  private async _consumeParticipantStream(
    asyncIterable: AsyncIterable<unknown>,
    renderer: { writeChunk(chunk: unknown): Promise<void>; end(): Promise<void> },
    token: CancellationToken,
    _span: unknown,
    startTime: number,
  ): Promise<number | undefined> {
    let ttft: number | undefined;
    for await (const event of asyncIterable) {
      if (token.isCancellationRequested) break;
      const evt = event as Record<string, unknown>;
      const normalized = normalizeMistralChunk(evt.data);
      if (!normalized) continue;

      if (!ttft && normalized.chunk.content) {
        ttft = Date.now() - startTime;
      }

      await renderer.writeChunk(normalized.chunk);
      if (span.isRecording()) {
        span.addEvent('chunk_processed', { content_length: normalized.chunk.content?.length ?? 0 });
      }
    }

    await renderer.end();
    return ttft;
  }

  /**
   * Translate OutputPart instances from @agentsy/processor into VS Code LanguageModelResponseParts.
   */
  private _emitProcessedParts(
    parts: OutputPart[],
    progress: Progress<LanguageModelResponsePart>,
    renderer: { markdown(content: string): void },
    toolCallAccumulator: ToolCallDeltaAccumulator,
    xmlFilter: XmlStreamFilter,
  ): void {
    const emitTextPart = (text: string): void => {
      if (this.activeToolNames.size > 0) {
        const xmlToolCalls = extractXmlToolCalls(text, this.activeToolNames);
        for (const xmlToolCall of xmlToolCalls) {
          const callId = xmlToolCall.id ?? this.generateToolCallId();
          const mappedCallId = this.getOrCreateVsCodeToolCallId(callId);
          this.log.info(`[Mistral] Emitting XML tool call id=${mappedCallId} name=${xmlToolCall.name}`);
          progress.report(
            new LanguageModelToolCallPart(
              mappedCallId,
              xmlToolCall.name,
              xmlToolCall.parameters as Record<string, unknown>,
            ),
          );
        }
      }

      const filteredText = xmlFilter.write(text);
      if (filteredText.length > 0) {
        renderer.markdown(filteredText);
      }
    };

    for (const part of parts) {
      if (part.type === 'text') {
        emitTextPart(part.text);
      } else if (part.type === 'thinking') {
        // Respect user setting: thinking blocks are not rendered in provider path.
        // Keep minimal debug visibility without leaking raw tags to users.
        const showThinking = workspace.getConfiguration('mistral').get<boolean>('thinkingSupport', true);
        if (showThinking) {
          this.log.debug(`[Mistral] thinking: ${part.text.slice(0, 200)}`);
        }
      } else if (part.type === 'tool_call') {
        const vsPart = toVSCodeToolCallPart(part, { fallbackCallId: () => this.generateToolCallId() });
        const mappedCallId = this.getOrCreateVsCodeToolCallId(vsPart.callId);
        this.log.info(`[Mistral] Emitting tool call id=${mappedCallId} name=${vsPart.name}`);
        progress.report(new LanguageModelToolCallPart(mappedCallId, vsPart.name, vsPart.input ?? {}));
      } else if (part.type === 'tool_call_delta') {
        accumulateToolCallDeltas(toolCallAccumulator, part);
      }
    }
  }

  /**
   * Validate tool messages and strip orphaned tool results.
   * Ensures every tool result has a matching tool call, preventing mismatches.
   */
  private validateToolMessages(messages: readonly LanguageModelChatRequestMessage[]): {
    valid: readonly LanguageModelChatRequestMessage[];
    strippedToolCallCount: number;
  } {
    const toolCallIds = new Set<string>();
    let stripped = 0;

    // First pass: collect all tool call IDs from assistant messages
    for (const msg of messages) {
      for (const part of msg.content) {
        if (part instanceof LanguageModelToolCallPart) {
          toolCallIds.add(part.callId);
        }
      }
    }

    // Second pass: filter out tool results without matching calls
    const valid = messages.filter(msg => {
      for (const part of msg.content) {
        if (part instanceof LanguageModelToolResultPart) {
          if (!toolCallIds.has(part.callId)) {
            this.log.warn(`[Mistral] Stripping orphaned tool result: ${part.callId}`);
            stripped++;
            return false;
          }
        }
      }
      return true;
    });

    type ValidationResult = {
      valid: readonly LanguageModelChatRequestMessage[];
      strippedToolCallCount: number;
    };
    return { valid, strippedToolCallCount: stripped };
  }

  /**
   * Convert VS Code chat messages into Mistral Chat Completion messages.
   *
   * Key rules (mirrors OpenAI/Mistral constraints):
   * - Assistant messages MUST have either non-empty content OR tool_calls.
   * - Tool results MUST be sent as role="tool" messages with tool_call_id.
   */
  public toMistralMessages(messages: readonly LanguageModelChatRequestMessage[]): MistralMessage[] {
    this.log.debug(`[Mistral] toMistralMessages called with ${messages.length} messages`);

    const outboundMessages: Array<{ role: MistralOutboundRole; parts: MessagePart[] }> = [];

    const ensureMistralId = (callId: string) => {
      const existing = this.getMistralToolCallId(callId);
      if (existing) return existing;
      const generated = this.generateToolCallId();
      this.toolCallIdMapping.set(callId, generated);
      this.reverseToolCallIdMapping.set(generated, callId);
      return generated;
    };

    for (const msg of messages) {
      const role = toMistralRole(msg.role);
      const outboundRole: MistralOutboundRole = role as MistralOutboundRole;
      const parts: Array<MessagePart> = [];
      const handlePart = (part: unknown) => {
        if (part instanceof LanguageModelTextPart) {
          parts.push({ type: 'text', text: part.value });
          return;
        }

        if (part instanceof LanguageModelDataPart) {
          const mime = part.mimeType ?? '';
          if (mime.startsWith('image/')) {
            parts.push({ type: 'image', mimeType: mime, data: part.data });
          } else if (!/stateful/i.test(mime) && mime.toLowerCase() !== 'stateful_marker') {
            // Preserve non-image data as a concise placeholder for model grounding
            // (e.g., PDFs), but suppress VS Code/Copilot stateful markers.
            parts.push({ type: 'text', text: `[data:${mime}]` });
          } // else: drop stateful markers entirely
          return;
        }

        if (part instanceof LanguageModelToolCallPart) {
          const mistralId = ensureMistralId(part.callId);
          parts.push({
            type: 'tool-call',
            callId: mistralId,
            name: part.name,
            input: (part.input ?? {}) as Record<string, unknown>,
          });
          return;
        }

        if (part instanceof LanguageModelToolResultPart) {
          const mistralId = ensureMistralId(part.callId);
          const resultText = part.content
            .filter(p => p instanceof LanguageModelTextPart)
            .map(p => p.value)
            .join('');
          parts.push({
            type: 'tool-result',
            callId: mistralId,
            content: resultText.length > 0 ? resultText : JSON.stringify(part.content),
          });
        }
      };

      for (const part of msg.content) {
        handlePart(part);
      }

      if (parts.length === 0) {
        continue;
      }

      const hasToolCall = parts.some(part => part.type === 'tool-call');
      const hasRenderableContent = parts.some(part => part.type === 'text' || part.type === 'image');
      if (outboundRole === 'assistant' && !hasToolCall && !hasRenderableContent) {
        continue;
      }

      outboundMessages.push({ role: outboundRole, parts });
    }

    return adaptersToMistralMessages(outboundMessages, {
      normalizeToolCallId: originalId => {
        // Preserve stable mapping to match tool results and outbound call IDs.
        if (this.reverseToolCallIdMapping.has(originalId)) {
          return originalId;
        }
        if (this.toolCallIdMapping.has(originalId)) {
          const mapped = this.toolCallIdMapping.get(originalId);
          if (mapped) return mapped;
        }
        const generated = this.generateToolCallId();
        this.toolCallIdMapping.set(originalId, generated);
        this.reverseToolCallIdMapping.set(generated, originalId);
        return generated;
      },
      onWarning: (message, context) => {
        this.log.warn(`Mistral stream parser: ${msg}${ctxStr}`);
      },
    }) as unknown as MistralMessage[];
  }

  /**
   * Provide token count for text or messages
   */
  async provideTokenCount(
    _model: LanguageModelChatInformation,
    text: string | LanguageModelChatRequestMessage,
    _token: CancellationToken,
  ): Promise<number> {
    // Keep a cached encoding instance; do not free it per-call.
    // (Freeing and reusing can cause use-after-free issues.)
    if (!this.tokenizer) {
      this.tokenizer = get_encoding('cl100k_base');
    }

    let textContent = '';

    if (typeof text === 'string') {
      textContent = text;
    } else {
      // Extract text from message parts including tool calls and results
      textContent = text.content
        .map(part => {
          if (part instanceof LanguageModelTextPart) {
            return part.value;
          } else if (part instanceof LanguageModelToolCallPart) {
            // Count tokens for tool calls (name + JSON-serialized input)
            return part.name + JSON.stringify(part.input);
          } else if (part instanceof LanguageModelToolResultPart) {
            // Count tokens for tool results
            return part.content
              .filter(resultPart => resultPart instanceof LanguageModelTextPart)
              .map(resultPart => (resultPart as LanguageModelTextPart).value)
              .join('');
          }
          return '';
        })
        .join('');
    }

    const tokens = this.tokenizer.encode(textContent);
    return tokens.length;
  }

  dispose(): void {
    try {
      this.tokenizer?.free();
    } catch (error) {
      this.log.debug(`[Mistral] tokenizer free failed: ${String(error)}`);
    }
    this.tokenizer = null;
    this.client = null;
    this.fetchedModels ??= null;
    this.modelsCacheExpiry = 0;
    this._onDidChangeLanguageModelChatInformation.dispose();
  }
}

/**
 * Convert VS Code message role to Mistral role
 */
export function toMistralRole(role: LanguageModelChatMessageRole): 'user' | 'assistant' | 'system' {
  if ((role as unknown as number) === 3) {
    return 'system';
  }
  switch (role) {
    case LanguageModelChatMessageRole.User:
      return 'user';
    case LanguageModelChatMessageRole.Assistant:
      return 'assistant';
    default:
      console.warn('[Mistral] Unknown role value; defaulting to user:', role);
      return 'user';
  }
}
