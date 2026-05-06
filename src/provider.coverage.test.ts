import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LanguageModelChatMessageRole,
  LanguageModelTextPart,
  LanguageModelToolResultPart,
  LanguageModelToolCallPart,
  LanguageModelChatMessage,
} from 'vscode';
import { MistralChatModelProvider } from './provider.js';

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
        return [] as any[];
      }
    },
    accumulateToolCallDeltas: vi.fn(),
    toVSCodeToolCallPart: vi.fn((part: any, opts: { fallbackCallId: () => string }) => ({
      callId: part.callId ?? opts.fallbackCallId(),
      name: part.name,
      input: part.input,
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
  processRawStream: async function* () {
    yield { parts: [{ type: 'text', text: 'hello world' }], usage: { inputTokens: 1, outputTokens: 1 } } as any;
  },
  toMistralMessages: (outbound: unknown) => outbound,
}));

const mockContext = {
  secrets: {
    get: vi.fn().mockResolvedValue('key'),
    store: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    onDidChange: vi.fn(),
  },
  subscriptions: [],
} as any;

describe('provider: retry and streaming coverage', () => {
  let provider: MistralChatModelProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new MistralChatModelProvider(mockContext, undefined, false);
  });

  it('retries on transient 500 and then streams text', async () => {
    // Avoid hitting real fetchModels path
    vi.spyOn(provider, 'fetchModels').mockResolvedValue([] as any);

    const chatStreamMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('500 Internal Server Error'))
      .mockResolvedValueOnce((async function* () {})());

    (provider as any).client = { chat: { stream: chatStreamMock } };

    const reported: string[] = [];
    const progress = { report: vi.fn() } as any;
    const model = {
      id: 'mistral-large-latest',
      name: 'Mistral',
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
    } as any;
    const msgs = [
      new LanguageModelChatMessage(LanguageModelChatMessageRole.User, [new LanguageModelTextPart('hi')]) as any,
    ];

    const p = provider.provideLanguageModelChatResponse(
      model,
      msgs as any,
      {},
      // Renderer writes forward to progress via our mock
      {
        report: (part: any) => {
          if (part?.value) reported.push(part.value);
        },
      } as any,
      { isCancellationRequested: false } as any,
    );

    // Advance fake timers so backoff delay resolves
    await vi.advanceTimersByTimeAsync(1100);
    await p;

    expect(chatStreamMock).toHaveBeenCalledTimes(2);
    expect(reported.join('\n')).toContain('hello world');
  });

  it('does not retry on 401 Unauthorized and reports friendly message', async () => {
    vi.spyOn(provider, 'fetchModels').mockResolvedValue([] as any);
    const chatStreamMock = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
    (provider as any).client = { chat: { stream: chatStreamMock } };

    const progress = { report: vi.fn() } as any;
    const model = { id: 'mistral-large-latest', name: 'M', maxInputTokens: 1, maxOutputTokens: 1 } as any;

    await provider.provideLanguageModelChatResponse(
      model,
      [{ role: LanguageModelChatMessageRole.User, content: [new LanguageModelTextPart('x')], name: undefined }] as any,
      {},
      progress,
      { isCancellationRequested: false } as any,
    );

    expect(chatStreamMock).toHaveBeenCalledTimes(1);
    const msg = progress.report.mock.calls.at(-1)?.[0]?.value as string | undefined;
    expect(msg).toMatch(/api key/i);
  });
});

describe('provider: helpers coverage', () => {
  let provider: MistralChatModelProvider;

  beforeEach(() => {
    provider = new MistralChatModelProvider(mockContext, undefined, false);
  });

  it('validateToolMessages strips orphan tool results', () => {
    const orphanResult = new LanguageModelToolResultPart('missing', [new LanguageModelTextPart('res')]);
    const messages = [new LanguageModelChatMessage(LanguageModelChatMessageRole.User, [orphanResult]) as any];
    const { valid, strippedToolCallCount } = (provider as any).validateToolMessages(messages);
    expect(strippedToolCallCount).toBeGreaterThanOrEqual(1);
    expect(valid).toHaveLength(0);
  });

  it('selectModel falls back when none provided', () => {
    const selected = (provider as any).selectModel(undefined, []);
    expect(selected).toBeDefined();
    expect(selected.id).toBeTruthy();
  });

  it('dispose frees tokenizer and clears state', () => {
    const free = vi.fn();
    (provider as any).tokenizer = { free };
    (provider as any).client = {};
    provider.dispose();
    expect(free).toHaveBeenCalled();
    expect((provider as any).client).toBeNull();
  });
});
