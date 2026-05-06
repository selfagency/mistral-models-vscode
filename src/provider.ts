import { Mistral } from '@mistralai/mistralai';
import { get_encoding, Tiktoken } from 'tiktoken';
import { randomUUID } from 'crypto';
import {
  CancellationToken,
  ChatResponseStream,
  Event,
  EventEmitter,
  ExtensionContext,
  LanguageModelChatInformation,
  LanguageModelChatMessageRole,
  LanguageModelChatProvider,
  LanguageModelChatRequestMessage,
  LanguageModelChatToolMode,
  LanguageModelDataPart,
  LanguageModelResponsePart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  LogOutputChannel,
  Progress,
  ProvideLanguageModelChatResponseOptions,
  StatusBarItem,
  window,
  workspace,
} from 'vscode';

type OutputPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; call: { id?: string; name: string; parameters: Record<string, unknown> } }
  | { type: 'tool_call_delta'; id?: string; name: string; argumentsDelta: string; index: number };

const cancellationTokenToAbortSignal = (token: CancellationToken): AbortSignal => {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }
  return controller.signal;
};

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

type MistralModelListItem = {
  id: string;
  name?: string | null;
  description?: string | null;
  maxContextLength?: number | null;
  maxCompletionTokens?: number | null;
  defaultModelTemperature?: number | null;
  capabilities?: {
    completionChat?: boolean;
    functionCalling?: boolean;
    vision?: boolean;
  };
};

const MODEL_OUTPUT_LIMITS: Record<string, number> = {
  'mistral-tiny-latest': 4096,
  'mistral-small-latest': 4096,
  'mistral-medium-latest': 4096,
  'mistral-large-latest': 16384,
  'codestral-latest': 8192,
  'devstral-latest': 16384,
  'pixtral-large-latest': 8192,
  'magistral-medium-latest': 8192,
  'magistral-small-latest': 4096,
};

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

export type MistralMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: MistralContent }
  | { role: 'assistant'; content: MistralContent | null; toolCalls?: MistralToolCall[]; prefix?: boolean }
  | { role: 'tool'; content: string | null; toolCallId: string; name?: string };

/**
 * Mistral Chat Model Provider
 * Implements VS Code's LanguageModelChatProvider interface for GitHub Copilot Chat
 */
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
  private tokensUsedThisSession = { input: 0, output: 0 };
  // Mapping from VS Code tool call IDs to Mistral tool call IDs
  private toolCallIdMapping = new Map<string, string>();
  // Mapping from Mistral tool call IDs to VS Code tool call IDs
  private reverseToolCallIdMapping = new Map<string, string>();
  private readonly log: LogOutputChannel;
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
    private readonly statusBarItem?: StatusBarItem,
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
    // Use crypto.randomUUID() and take first 9 characters of alphanumeric representation
    const uuid = randomUUID().replace(/-/g, '');
    return uuid.substring(0, 9);
  }

  /**
   * Get or create a VS Code-compatible tool call ID from a Mistral tool call ID
   */
  public getOrCreateVsCodeToolCallId(mistralId: string): string {
    // Check if we already have a mapping for this Mistral ID
    if (this.reverseToolCallIdMapping.has(mistralId)) {
      return this.reverseToolCallIdMapping.get(mistralId)!;
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
          this.log.debug('[Mistral] setupHasKeyContext failed: ' + String(error));
        }

        manager.onDidChangeApiKey((_event, newKey) => {
          this.client = newKey ? new Mistral({ apiKey: newKey }) : null;
          this.fetchedModels = null;
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
      const noCancellationToken = { isCancellationRequested: false } as CancellationToken;
      const response = await this.withRetry(() => this.client!.models.list(), noCancellationToken);
      // Deduplicate by model id to avoid repeated entries and map to our MistralModel shape.
      const byId = new Map<string, MistralModelListItem>();
      for (const m of response.data ?? []) {
        if (!m || typeof m !== 'object') continue;
        const candidate = m as Partial<MistralModelListItem>;
        if (typeof candidate.id !== 'string') continue;
        if (!candidate.capabilities?.completionChat) continue;
        if (!byId.has(candidate.id)) {
          byId.set(candidate.id, {
            id: candidate.id,
            name: candidate.name ?? null,
            description: candidate.description ?? null,
            maxContextLength: candidate.maxContextLength ?? null,
            maxCompletionTokens: candidate.maxCompletionTokens ?? null,
            defaultModelTemperature: candidate.defaultModelTemperature ?? null,
            capabilities: candidate.capabilities,
          });
        }
      }
      const rawModels = Array.from(byId.values()).map(m => ({
        id: m.id,
        originalName: m.name ?? formatModelName(m.id),
        detail: m.description ?? undefined,
        maxInputTokens: m.maxContextLength ?? 32768,
        maxOutputTokens:
          (typeof m.maxCompletionTokens === 'number' && m.maxCompletionTokens > 0
            ? m.maxCompletionTokens
            : undefined) ??
          MODEL_OUTPUT_LIMITS[String(m.id).toLowerCase()] ??
          DEFAULT_MAX_OUTPUT_TOKENS,
        defaultCompletionTokens: DEFAULT_COMPLETION_TOKENS,
        toolCalling: m.capabilities?.functionCalling ?? false,
        supportsParallelToolCalls: m.capabilities?.functionCalling ?? false,
        supportsVision: m.capabilities?.vision ?? false,
        temperature: m.defaultModelTemperature ?? undefined,
      }));

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
      this.log.error('[Mistral] Failed to fetch Mistral models: ' + String(error));
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
    this.log.debug('[Mistral] Prompting user for API key (existing present: ' + !!before + ')');

    const input = await window.showInputBox({
      placeHolder: 'Mistral API Key',
      password: true,
      value: before || '',
      prompt: 'Enter your Mistral API key (get one at https://console.mistral.ai/)',
      ignoreFocusOut: true,
    });

    const trimmedInput = input?.trim();
    if (!trimmedInput) {
      this.log.info('[Mistral] setApiKey canceled by user');
      return undefined;
    }

    let after: string | undefined;
    try {
      await manager.setApiKey(trimmedInput);
      after = await manager.getApiKey();
    } catch (error) {
      this.log.warn('[Mistral] Failed to store API key in secret storage: ' + String(error));
      this.client = new Mistral({ apiKey: trimmedInput });
      this.fetchedModels = null;
      this.modelsCacheExpiry = 0;
      this._onDidChangeLanguageModelChatInformation.fire(undefined);
      return trimmedInput;
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
    this.log.debug('[Mistral] initClient called (silent=' + silent + ', hasStoredKey=' + !!apiKey + ')');
    if (!silent && !apiKey) {
      apiKey = await this.setApiKey();
    } else if (apiKey) {
      this.client = new Mistral({ apiKey });
    }

    this.log.debug('[Mistral] initClient result: ' + !!apiKey);
    return !!apiKey;
  }

  /**
   * Provide available chat model information
   */
  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    this.log.info('[Mistral] provideLanguageModelChatInformation called (silent=' + options.silent + ')');
    if (token.isCancellationRequested) {
      this.log.debug('[Mistral] provideLanguageModelChatInformation cancelled before init');
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

    if (token.isCancellationRequested) {
      this.log.debug('[Mistral] provideLanguageModelChatInformation cancelled after init');
      return [];
    }

    const initialized = await this.initClient(options.silent);
    if (!initialized) {
      this.log.warn('[Mistral] client not initialized');
      return [];
    }

    if (token.isCancellationRequested) {
      this.log.debug('[Mistral] provideLanguageModelChatInformation cancelled before fetch');
      return [];
    }

    const models = await this.fetchModels();
    this.log.info('[Mistral] Returning ' + models.length + ' models');
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
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      defaultCompletionTokens: DEFAULT_COMPLETION_TOKENS,
      toolCalling: true,
      supportsParallelToolCalls: false,
      supportsVision: false,
    };

    // Convert VS Code messages to Mistral format.
    // Important: a single VS Code message can include multiple tool results. Those must become
    // separate `role:"tool"` messages instead of replacing the whole message.
    const mistralMessages = this.toMistralMessages(messages);

    // Convert VS Code tools to Mistral format
    const mistralTools = options.tools?.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || {},
      },
    }));

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
    const stop =
      typeof modelOptions.stop === 'string'
        ? modelOptions.stop
        : Array.isArray(modelOptions.stop) && modelOptions.stop.every(item => typeof item === 'string')
          ? modelOptions.stop
          : undefined;
    const presencePenalty = typeof modelOptions.presencePenalty === 'number' ? modelOptions.presencePenalty : undefined;
    const frequencyPenalty =
      typeof modelOptions.frequencyPenalty === 'number' ? modelOptions.frequencyPenalty : undefined;
    const promptMode = modelOptions.promptMode === 'reasoning' ? 'reasoning' : undefined;

    const abortController = new AbortController();
    const cancellationDisposable =
      typeof token.onCancellationRequested === 'function'
        ? token.onCancellationRequested(() => {
            abortController.abort();
            this.log.info('[Mistral] Request cancelled by user');
          })
        : undefined;

    try {
      const [{ normalizeMistralChunk }, { LLMStreamProcessor }] = await Promise.all([
        import('@agentsy/normalizers'),
        import('@agentsy/processor'),
      ]);

      // Create chat completion request with streaming
      const stream = await this.client.chat.stream(
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
        { signal: abortController.signal },
      );

      const processor = new LLMStreamProcessor({
        modelId: model.id,
        accumulateNativeToolCalls: true,
        onWarning: (msg, ctx) =>
          this.log.warn('[Mistral] stream parser: ' + msg + (ctx ? ' ' + JSON.stringify(ctx) : '')),
      });

      processor.on('usage', usage => {
        this.log.info(`[Mistral] usage input=${usage.inputTokens ?? 0} output=${usage.outputTokens ?? 0}`);
      });
      processor.on('conversation_event', event => {
        if (event.type === 'step_started' || event.type === 'step_finished') {
          this.log.info(
            `[Mistral] step ${event.stepIndex}` +
              (event.usage ? ` (input=${event.usage.inputTokens ?? 0}, output=${event.usage.outputTokens ?? 0})` : ''),
          );
        } else if (event.type === 'step_updated') {
          this.log.info(`[Mistral] step updated: ${event.stepIndex}`);
        }
      });
      processor.on('tool_call_delta', delta => {
        this.log.debug(`[Mistral] tool_call_delta ${delta.name}[${delta.index}] +${delta.argumentsDelta.length} chars`);
      });

      for await (const event of stream) {
        if (token.isCancellationRequested) break;

        const normalized = normalizeMistralChunk(event.data);
        if (!normalized) continue;

        this.log.debug('[Mistral] stream chunk received');
        const output = processor.process(normalized.chunk);
        this._emitParts(output.parts, progress);
      }

      const final = processor.flush();
      this._emitParts(final.parts, progress);

      if (final.incomplete) {
        this.log.warn(
          '[Mistral] stream ended with incomplete content: ' + final.incompleteness.map(i => i.type).join(', '),
        );
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
      cancellationDisposable?.dispose();
    }
  }

  /**
   * Stream a participant response directly from Mistral using @agentsy/vscode renderer.
   */
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
    const selectedModel = (modelId ? models.find(model => model.id === modelId) : undefined) ??
      models[0] ?? {
        id: modelId ?? 'mistral-large-latest',
        name: modelId ?? 'Mistral',
        maxInputTokens: 32768,
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        defaultCompletionTokens: DEFAULT_COMPLETION_TOKENS,
        toolCalling: false,
        supportsParallelToolCalls: false,
        supportsVision: false,
      };

    const mistralMessages = this.toMistralMessages(messages);

    try {
      const [{ createVSCodeAgentLoop, cancellationTokenToAbortSignal }, { normalizeMistralChunk }] = await Promise.all([
        import('@agentsy/vscode'),
        import('@agentsy/normalizers'),
      ]);

      const renderer = createVSCodeAgentLoop({
        stream: stream as unknown as AgentsyChatResponseStreamCompat,
        thinkingStyle: 'progress',
        abortSignal: cancellationTokenToAbortSignal(token),
        onFinish: (finishReason, usage) => {
          this.log.info(
            '[Mistral] participant stream finished: ' +
              String(finishReason ?? 'unknown') +
              (usage ? ` (input=${usage.inputTokens ?? 0}, output=${usage.outputTokens ?? 0})` : ''),
          );
        },
        onStep: (stepIndex, usage) => {
          this.log.info(
            `[Mistral] participant step ${stepIndex}` +
              (usage ? ` (input=${usage.inputTokens ?? 0}, output=${usage.outputTokens ?? 0})` : ''),
          );
        },
        onToolCallDelta: delta => {
          this.log.debug(
            `[Mistral] participant tool_call_delta ${delta.name}[${delta.index}] +${delta.argumentsDelta.length} chars`,
          );
        },
      });

      const mistralStream = await this.client.chat.stream(
        {
          model: selectedModel.id,
          messages: mistralMessages,
          maxTokens: Math.min(selectedModel.defaultCompletionTokens, selectedModel.maxOutputTokens),
          temperature: selectedModel.temperature ?? 0.7,
          topP: selectedModel.top_p,
        },
        { signal: cancellationTokenToAbortSignal(token) },
      );

      for await (const event of mistralStream) {
        if (token.isCancellationRequested) {
          break;
        }
        const normalized = normalizeMistralChunk(event.data);
        if (!normalized) {
          continue;
        }
        await renderer.writeChunk(normalized.chunk);
      }

      await renderer.end();
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
    }
  }

  /**
   * Translate OutputPart instances from @agentsy/processor into VS Code LanguageModelResponseParts.
   */
  private _emitParts(parts: OutputPart[], progress: Progress<LanguageModelResponsePart>): void {
    for (const part of parts) {
      if (part.type === 'text') {
        this.log.debug('[Mistral] streaming text chunk: ' + part.text.slice(0, 200));
        progress.report(new LanguageModelTextPart(part.text));
      } else if (part.type === 'thinking') {
        this.log.debug('[Mistral] thinking: ' + part.text.slice(0, 200));
        // Thinking content logged only; no stable VS Code API yet.
      } else if (part.type === 'tool_call') {
        const callId = part.call.id ?? this.generateToolCallId();
        const vsCodeId = this.getOrCreateVsCodeToolCallId(callId);
        this.log.info(`[Mistral] Emitting tool call id=${vsCodeId} name=${part.call.name}`);
        progress.report(new LanguageModelToolCallPart(vsCodeId, part.call.name, part.call.parameters));
      } else if (part.type === 'tool_call_delta') {
        // Deltas are internal stream fragments; complete calls are emitted as tool_call.
        this.log.debug(`[Mistral] tool_call_delta ${part.name}[${part.index}] +${part.argumentsDelta.length} chars`);
      }
      // tool_call_delta: only emitted when accumulateNativeToolCalls=false; unused here.
    }
  }

  /**
   * Convert VS Code chat messages into Mistral Chat Completion messages.
   *
   * Key rules (mirrors OpenAI/Mistral constraints):
   * - Assistant messages MUST have either non-empty content OR tool_calls.
   * - Tool results MUST be sent as role="tool" messages with tool_call_id.
   */
  public toMistralMessages(messages: readonly LanguageModelChatRequestMessage[]): MistralMessage[] {
    this.log.debug('[Mistral] toMistralMessages called with ' + messages.length + ' messages');
    const out: MistralMessage[] = [];
    const toolNameByCallId = new Map<string, string>();

    for (const msg of messages) {
      const role = toMistralRole(msg.role);
      const textParts: string[] = [];
      const imageParts: Array<{ mimeType: string; data: Uint8Array }> = [];
      const toolCalls: MistralToolCall[] = [];
      const toolResults: Array<{ callId: string; content: string }> = [];

      for (const part of msg.content) {
        if (part instanceof LanguageModelTextPart) {
          textParts.push(part.value);
          continue;
        }

        if (part instanceof LanguageModelDataPart) {
          // Only handle images. For any other data parts, stringify as text.
          if (part.mimeType?.startsWith('image/')) {
            imageParts.push({ mimeType: part.mimeType, data: part.data });
          } else {
            textParts.push(`[data:${part.mimeType}]`);
          }
          continue;
        }

        if (part instanceof LanguageModelToolCallPart) {
          // Map VS Code tool call ID to Mistral tool call ID
          // If no mapping exists, generate a valid 9-char alphanumeric ID
          let mistralId = this.getMistralToolCallId(part.callId);
          if (!mistralId) {
            mistralId = this.generateToolCallId();
            this.toolCallIdMapping.set(part.callId, mistralId);
            this.reverseToolCallIdMapping.set(mistralId, part.callId);
          }
          toolNameByCallId.set(mistralId, part.name);
          toolCalls.push({
            id: mistralId,
            type: 'function',
            function: {
              name: part.name,
              arguments: JSON.stringify(part.input ?? {}),
            },
          });
          continue;
        }

        if (part instanceof LanguageModelToolResultPart) {
          // Map VS Code tool call ID to Mistral tool call ID
          // If no mapping exists, generate a valid 9-char alphanumeric ID
          let mistralId = this.getMistralToolCallId(part.callId);
          if (!mistralId) {
            mistralId = this.generateToolCallId();
            this.toolCallIdMapping.set(part.callId, mistralId);
            this.reverseToolCallIdMapping.set(mistralId, part.callId);
          }
          const resultText = part.content
            .filter(p => p instanceof LanguageModelTextPart)
            .map(p => (p as LanguageModelTextPart).value)
            .join('');
          toolResults.push({
            callId: mistralId,
            content: resultText && resultText.length > 0 ? resultText : JSON.stringify(part.content),
          });
          continue;
        }
      }

      const content = textParts.join('');
      const hasContent = content.length > 0;
      const hasToolCalls = toolCalls.length > 0;
      const hasImages = imageParts.length > 0;

      let messageContent: MistralMessage['content'] | undefined = undefined;
      if (hasImages) {
        // Mistral expects a chunk-array for multimodal messages.
        const chunks: Array<{ type: 'text'; text: string } | { type: 'image_url'; imageUrl: string }> = [];
        if (hasContent) {
          chunks.push({ type: 'text', text: content });
        }
        for (const img of imageParts) {
          const base64 = Buffer.from(img.data).toString('base64');
          chunks.push({ type: 'image_url', imageUrl: `data:${img.mimeType};base64,${base64}` });
        }
        messageContent = chunks;
      } else if (hasContent) {
        messageContent = content;
      }

      // Only include non-empty user/system messages.
      // Include assistant messages if they have content OR tool calls.
      if (role === 'assistant') {
        if (hasContent || hasToolCalls) {
          out.push({
            role,
            // If this assistant message is only tool calls, prefer `null` content (matches SDK schema).
            content: messageContent ?? (hasToolCalls ? null : ''),
            toolCalls: hasToolCalls ? toolCalls : undefined,
          });
        }
      } else if (role === 'system') {
        if (typeof messageContent === 'string') {
          out.push({ role: 'system', content: messageContent });
        }
      } else {
        if (messageContent !== undefined) {
          out.push({ role: 'user', content: messageContent });
        }
      }

      // Tool result messages come after the message that carried them.
      for (const tr of toolResults) {
        out.push({
          role: 'tool',
          content: tr.content,
          toolCallId: tr.callId,
          name: toolNameByCallId.get(tr.callId),
        });
      }
    }

    return out;
  }

  public dispose(): void {
    this.tokenizer = null;
    this.statusBarItem?.hide();
    this._onDidChangeLanguageModelChatInformation.dispose();
    this.client = null;
  }

  public getUsageStats(): { input: number; output: number } {
    return { ...this.tokensUsedThisSession };
  }

  private updateStatusBar(): void {
    if (!this.statusBarItem) {
      return;
    }
    const { input, output } = this.tokensUsedThisSession;
    if (input === 0 && output === 0) {
      this.statusBarItem.hide();
      return;
    }
    this.statusBarItem.text = `$(hubot) Mistral ${input}↑ ${output}↓`;
    this.statusBarItem.tooltip = `Mistral session usage — input: ${input}, output: ${output}`;
    this.statusBarItem.show();
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    token: CancellationToken,
    maxRetries = 3,
    baseDelayMs = 1000,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (token.isCancellationRequested) {
        throw new Error('[Mistral] Request cancelled by user');
      }
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const statusCode = (error as { statusCode?: unknown }).statusCode;
        const isRetryable = typeof statusCode === 'number' && (statusCode === 429 || statusCode >= 500);
        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
        this.log.warn(`[Mistral] Retrying (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  /**
   * Provide token count for text or messages.
   *
   * IMPORTANT: Uses OpenAI's cl100k_base tokenizer as an approximation.
   * Mistral uses its own tokenizer, so counts may differ by 10-30%.
   * This is a known limitation for JavaScript clients today.
   *
   * Bundle size note: We use js-tiktoken/lite with a single rank file
   * (cl100k_base) to avoid bundling WASM assets.
   */
  async provideTokenCount(
    _model: LanguageModelChatInformation,
    text: string | LanguageModelChatRequestMessage,
    _token: CancellationToken,
  ): Promise<number> {
    // Keep a cached encoder instance.
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
}

/**
 * Convert VS Code message role to Mistral role
 */
export function toMistralRole(role: LanguageModelChatMessageRole): 'user' | 'assistant' | 'system' {
  switch (role) {
    case LanguageModelChatMessageRole.User:
      return 'user';
    case LanguageModelChatMessageRole.Assistant:
      return 'assistant';
    // System role support for forward compatibility (may not exist in older @types/vscode)
    default:
      if ((role as unknown) === 3) {
        // LanguageModelChatMessageRole.System = 3 (if available in future VS Code versions)
        return 'system';
      }
      console.warn(`[Mistral] Unknown chat message role: ${String(role)}, mapping to 'user'`);
      return 'user';
  }
}
