import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MistralModel } from './provider.js';
import { MistralChatModelProvider } from './provider.js';
import {
  CancellationToken,
  ExtensionContext,
  LanguageModelChatInformation,
  LanguageModelChatRequestMessage,
  LanguageModelResponsePart,
  Progress,
  LanguageModelChatRequestMessage as LanguageModelChatMessage,
  LanguageModelChatRequestMessage as LanguageModelChatMessageRole,
  LanguageModelChatToolMode,
} from 'vscode';

vi.mock('@agentsy/xml-filter', () => ({
  createXmlStreamFilter: vi.fn().mockReturnValue({
    write: (t: string) => t,
    end: () => '',
  }),
}));

vi.mock('@agentsy/adapters', () => ({
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
    vi.spyOn(provider, 'fetchModels').mockResolvedValue([] as MistralModel[]);

    const chatStreamMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('500 Internal Server Error'))
      .mockResolvedValueOnce((async function* () {})()) as any;

    (provider as unknown as { client: unknown }).client = { chat: { stream: chatStreamMock } };

    const reported: string[] = [];
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

    const mockProgressReport: (part: LanguageModelResponsePart) => void = part => {
      if (part instanceof LanguageModelTextPart) reported.push(part.value);
    };

    const p = provider.provideLanguageModelChatResponse(
      model,
      msgs,
      { toolMode: LanguageModelChatToolMode.Auto },
      mockProgressReport as unknown as Progress<LanguageModelResponsePart>,
      { isCancellationRequested: false } as CancellationToken,
    );

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
      { toolMode: LanguageModelChatToolMode.Auto },
      progress,
      { isCancellationRequested: false } as CancellationToken,
    );

    expect(chatStreamMock).toHaveBeenCalledTimes(1);
    const reportedResult =
      progress.report instanceof ReturnType<typeof vi.fn>
        ? (progress.report as ReturnType<typeof vi.fn>).mock.calls
        : undefined;
    const msgValue = reportedResult?.at(-1)?.[0];
    expect(msgValue).toBeInstanceOf(LanguageModelTextPart);
    expect((msgValue as LanguageModelTextPart).value).toMatch(/api key/i);
  });

  it('validateToolMessages strips orphan tool results', () => {
    const orphanResult = new vscode.LanguageModelToolResultPart('missing', [new vscode.LanguageModelTextPart('res')]);
    const messages: vscode.LanguageModelChatRequestMessage[] = [
      new vscode.LanguageModelChatMessage(vscode.LanguageModelChatRequestMessageRole.User, [orphanResult]),
    ];
    const validation: {
      valid: readonly vscode.LanguageModelChatRequestMessage[];
      strippedToolCallCount: number;
    } = (provider as MistralChatModelProvider).validateToolMessages(messages);
    expect(validation.strippedToolCallCount).toBeGreaterThanOrEqual(1);
    expect(validation.valid).toHaveLength(0);
  });

  it('selectModel falls back when none provided', () => {
    const selected: { id: string } = (provider as MistralChatModelProvider).selectModel(undefined, []) as {
      id: string;
    };
    expect(selected).toBeDefined();
    expect(selected.id).toBeTruthy();
  });

  it('dispose frees tokenizer and clears state', () => {
    const free = vi.fn();
    (provider as any).tokenizer = { free };
    (provider as any).client = null;
    provider.dispose();
    expect(free).toHaveBeenCalled();
    expect((provider as any).client).toBeNull();
  });
});
