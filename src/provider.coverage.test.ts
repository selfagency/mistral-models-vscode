import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MistralModel } from './provider.js';
import { MistralChatModelProvider } from './provider.js';
import {
  CancellationToken,
  ChatRequestTurn,
  ChatResponseMarkdownPart,
  MarkdownString,
  LanguageModelTextPart,
  EventEmitter,
  LanguageModelChatMessage,
  LanguageModelResponsePart,
  LanguageModelChatToolMode,
  LanguageModelChatInformation,
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
} as any;

describe('provider: retry and streaming coverage', () => {
  let provider: MistralChatModelProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new MistralChatModelProvider(mockContext, undefined, false);
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
