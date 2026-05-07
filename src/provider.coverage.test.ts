import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CancellationToken,
  ExtensionContext,
  LanguageModelChatInformation,
  LanguageModelChatMessage,
  LanguageModelChatMessageRole,
  LanguageModelChatRequestMessage,
  LanguageModelChatToolMode,
  LanguageModelResponsePart,
  LanguageModelTextPart,
  LanguageModelToolResultPart,
  Progress,
} from 'vscode';
import { MistralChatModelProvider, MistralModel } from './provider.js';

// Local, file-scoped mocks so we don't affect existing tests
vi.mock('@agentsy/vscode', () => {
  return {
    cancellationTokenToAbortSignal: vi.fn(() => new AbortController().signal),
    createVSCodeChatRenderer: vi.fn().mockImplementation(({ stream }) => ({
      markdown: (content: string) => stream.markdown(content),
    })),
    // Minimal implementations used by provider internals
    ToolCallDeltaAccumulator: class {
      finalize() {
        return [];
      }
    },
    accumulateToolCallDeltas: vi.fn(),
    toVSCodeToolCallPart: vi.fn((part: Record<string, unknown>, opts: { fallbackCallId: () => string }) => ({
      callId: (part.callId as string) ?? opts.fallbackCallId(),
      name: part.name as string,
      input: part.input as Record<string, unknown>,
    })),
    mapUsageToVSCode: vi.fn(() => ({ promptTokens: 1, completionTokens: 1 })),
  };
});

vi.mock('@agentsy/xml-filter', () => ({
  createXmlStreamFilter: vi.fn().mockReturnValue({
    write: (t: string) => t,
    end: () => '',
  }),
}));

vi.mock('@agentsy/adapters', () => ({
  // Ignore the actual client stream; just yield a single normalized output object
  processRawStream: async function* (): AsyncIterable<unknown> {
    yield { parts: [{ type: 'text', text: 'hello world' }], usage: { inputTokens: 1, outputTokens: 1 } };
  },
  toMistralMessages: (outbound: unknown) => outbound,
}));

const mockContext = {
  secrets: {
    get: vi.fn().mockResolvedValue('key'),
    store: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    onDidChange: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
  },
  subscriptions: [],
} as unknown as ExtensionContext;

describe('provider: retry and streaming coverage', () => {
  let provider: MistralChatModelProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new MistralChatModelProvider(mockContext, undefined, false);
  });

  it('retries on transient 500 and then streams text', async () => {
    // Avoid hitting real fetchModels path
    vi.spyOn(provider, 'fetchModels').mockResolvedValue([] as MistralModel[]);

    const chatStreamMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('500 Internal Server Error'))
      .mockResolvedValueOnce((async function* () {})());

    (provider as unknown as { client: unknown }).client = { chat: { stream: chatStreamMock } };

    const reported: string[] = [];
    const progress = { report: vi.fn() };
    const model: LanguageModelChatInformation = {
      id: 'mistral-large-latest',
      name: 'Mistral',
      family: 'mistral',
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
      version: '1.0',
      capabilities: {
        toolCalling: true,
        imageInput: false,
      },
    };
    const msgs: LanguageModelChatRequestMessage[] = [
      new LanguageModelChatMessage(LanguageModelChatMessageRole.User, [new LanguageModelTextPart('hi')]),
    ];

    const p = provider.provideLanguageModelChatResponse(
      model,
      msgs,
      { toolMode: LanguageModelChatToolMode.Auto },
      // Renderer writes forward to progress via our mock
      {
        report: (part: LanguageModelResponsePart) => {
          if (part instanceof LanguageModelTextPart) reported.push(part.value);
        },
      } as Progress<LanguageModelResponsePart>,
      { isCancellationRequested: false } as CancellationToken,
    );

    // Advance fake timers so backoff delay resolves
    await vi.advanceTimersByTimeAsync(1100);
    await p;

    expect(chatStreamMock).toHaveBeenCalledTimes(2);
    expect(reported.join('\n')).toContain('hello world');
  });

  it('does not retry on 401 Unauthorized and reports friendly message', async () => {
    vi.spyOn(provider, 'fetchModels').mockResolvedValue([] as MistralModel[]);
    const chatStreamMock = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
    (provider as unknown as { client: unknown }).client = { chat: { stream: chatStreamMock } };

    const progress = { report: vi.fn() };
    const model: LanguageModelChatInformation = {
      id: 'mistral-large-latest',
      name: 'M',
      family: 'mistral',
      maxInputTokens: 1,
      maxOutputTokens: 1,
      version: '1.0',
      capabilities: { toolCalling: true, imageInput: false },
    };

    await provider.provideLanguageModelChatResponse(
      model,
      [{ role: LanguageModelChatMessageRole.User, content: [new LanguageModelTextPart('x')], name: undefined }],
      { toolMode: LanguageModelChatToolMode.Auto }, // Corrected missing toolMode
      progress as Progress<LanguageModelResponsePart>, // Cast here for the function call
      { isCancellationRequested: false } as CancellationToken,
    );

    expect(chatStreamMock).toHaveBeenCalledTimes(1);
    const msg = (progress.report as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | LanguageModelTextPart
      | undefined;
    expect(msg?.value).toMatch(/api key/i);
  });
});

describe('provider: helpers coverage', () => {
  let provider: MistralChatModelProvider;

  beforeEach(() => {
    provider = new MistralChatModelProvider(mockContext, undefined, false);
  });

  it('validateToolMessages strips orphan tool results', () => {
    const orphanResult = new LanguageModelToolResultPart('missing', [new LanguageModelTextPart('res')]);
    const messages: LanguageModelChatRequestMessage[] = [
      new LanguageModelChatMessage(LanguageModelChatMessageRole.User, [orphanResult]),
    ];
    const { valid, strippedToolCallCount } = (
      provider as unknown as {
        validateToolMessages(m: LanguageModelChatRequestMessage[]): {
          valid: LanguageModelChatRequestMessage[];
          strippedToolCallCount: number;
        };
      }
    ).validateToolMessages(messages);
    expect(strippedToolCallCount).toBeGreaterThanOrEqual(1);
    expect(valid).toHaveLength(0);
  });

  it('selectModel falls back when none provided', () => {
    const selected = (provider as unknown as { selectModel(m: unknown, ms: unknown[]): { id: string } }).selectModel(
      undefined,
      [],
    );
    expect(selected).toBeDefined();
    expect(selected.id).toBeTruthy();
  });

  it('dispose frees tokenizer and clears state', () => {
    const free = vi.fn();
    (provider as unknown as { tokenizer: { free: () => void } | null }).tokenizer = { free };
    (provider as unknown as { client: unknown }).client = null;
    provider.dispose();
    expect(free).toHaveBeenCalled();
    expect((provider as unknown as { client: unknown }).client).toBeNull();
  });
});
