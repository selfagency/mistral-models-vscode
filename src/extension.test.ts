import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  chat,
  ChatRequestTurn,
  ChatResponseMarkdownPart,
  ChatResponseTurn,
  commands,
  lm,
  MarkdownString,
  window,
} from 'vscode';
import { activate, deactivate } from './extension.js';

const mockProviderInstance: typeof import('./provider.js').MistralChatModelProvider = {
  setApiKey: vi.fn(),
  dispose: vi.fn(),
  streamParticipantResponse: vi.fn().mockResolvedValue(undefined),
  _onDidChangeLanguageModelChatInformation: { fire: vi.fn(), dispose: vi.fn() },
  generateToolCallId: vi.fn(),
  getOrCreateVsCodeToolCallId: vi.fn(),
  getMistralToolCallId: vi.fn(),
  getClient: vi.fn(),
  fetchModels: vi.fn(),
  clearToolCallIdMappings: vi.fn(),
  setApiKey: vi.fn(),
  initClient: vi.fn().mockResolvedValue(false),
  provideLanguageModelChatInformation: vi.fn(),
  provideLanguageModelChatResponse: vi.fn().mockResolvedValue(undefined),
  streamParticipantResponse: vi.fn().mockResolvedValue(undefined),
  validateToolMessages: vi.fn(),
  toMistralMessages: vi.fn().mockReturnValue([]),
  provideTokenCount: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('./provider', () => ({
  MistralChatModelProvider: vi
    .fn()
    .mockImplementation((context: vscode.ExtensionContext, _logOutputChannel?: vscode.LogOutputChannel) => {
      return mockProviderInstance;
    }),
}));

describe('extension', () => {
  const mockContext = {
    subscriptions: { push: vi.fn() },
    extensionUri: '/fake-extension',
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderInstance.setApiKey.mockResolvedValue(undefined);
    mockProviderInstance.streamParticipantResponse.mockResolvedValue(undefined);
    (mockContext as any).subscriptions = { push: vi.fn() };
  });

  describe('activate', () => {
    it('registers the language model chat provider', () => {
      activate(mockContext);
      expect(lm.registerLanguageModelChatProvider).toHaveBeenCalledWith('mistral', expect.any(Object));
    });

    it('registers the manageApiKey command', () => {
      activate(mockContext);
      expect(commands.registerCommand).toHaveBeenCalledWith('mistral-chat.manageApiKey', expect.any(Function));
    });

    it('pushes provider and command disposables into context.subscriptions', () => {
      activate(mockContext);
      // First push call is provider + command
      const pushCalls = mockContext.subscriptions.push.mock.calls;
      expect(pushCalls[0]).toHaveLength(2);
    });

    it('creates output channel and tracks it in subscriptions', () => {
      activate(mockContext);
      expect(window.createOutputChannel).toHaveBeenCalledWith('Mistral Models', { log: true });
      expect(pushCalls[1]).toHaveLength(1);
    });

    it('creates the @mistral chat participant', () => {
      activate(mockContext);
      expect(chat.createChatParticipant).toHaveBeenCalledWith('mistral-models-vscode.mistral', expect.any(Function));
    });

    it('pushes participant disposable into context.subscriptions', () => {
      activate(mockContext);
      // Third push call is the participant (after provider+command+dispose and output/status items)
      expect(mockContext.subscriptions.push).toHaveBeenCalledTimes(3);
      expect(pushCalls[2]).toHaveLength(1);
    });
  });

  describe('activate — participant handler', () => {
    let pushCalls: ReturnType<typeof mockContext.copyWithSubscriptions.push.mock.calls>;

    async function getHandler() {
      activate(mockContext);
      pushCalls = (chat.createChatParticipant as ReturnType<typeof vi.fn>).mock.calls || [];
      const handler = pushCalls[0]?.[1];
      return handler;
    }

    it('sends history + prompt to provider.streamParticipantResponse', async () => {
      const handler = await getHandler();
      const mockStream = { markdown: vi.fn(), progress: vi.fn() };

      const mockRequest = { prompt: 'hello', model: { id: 'mistral-large-latest' } };
      const mockChatContext = { history: [] };
      const mockToken = { isCancellationRequested: false };

      await handler(mockRequest, mockChatContext, mockStream, mockToken);

      expect(mockProviderInstance.streamParticipantResponse).toHaveBeenCalledOnce();
      const mockCalls = mockProviderInstance.streamParticipantResponse.mock.calls || [];
      const [modelId, messages] = mockCalls[0] ?? [];
      expect(modelId).toBe('mistral-large-latest');
      const lastMessage = messages?.at(-1);
      expect(lastMessage.content).toBe('hello');
    });

    it('passes stream object through to provider', async () => {
      const handler = await getHandler();

      const mockStream = { markdown: vi.fn(), progress: vi.fn() };

      await handler({ prompt: 'test', model: { id: 'mistral-small-latest' } }, { history: [] }, mockStream, {
        isCancellationRequested: false,
      });

      expect(mockProviderInstance.streamParticipantResponse).toHaveBeenCalledWith(
        'mistral-small-latest',
        expect.any(Array),
        mockStream,
        expect.any(Object),
      );
    });

    it('includes prior ChatRequestTurn as a User message in history', async () => {
      const handler = await getHandler();

      const priorRequest = new (ChatRequestTurn as any)('prior question');
      await handler(
        { prompt: 'follow-up', model: { id: 'mistral-large-latest' } },
        { history: [priorRequest] },
        { markdown: vi.fn(), progress: vi.fn() },
        { isCancellationRequested: false },
      );

      const mockCalls = mockProviderInstance.streamParticipantResponse.mock.calls || [];
      const [modelId, messages] = mockCalls[0] ?? [];
      const messageArray = messages ?? [];
      const firstMessage = messageArray[0];
      expect(firstMessage.content).toBe('prior question');
      const secondMessage = messageArray[1];
      expect(secondMessage.content).toBe('follow-up');
    });

    it('includes prior ChatResponseTurn as an Assistant message in history', async () => {
      const handler = await getHandler();

      const priorResponse = new (ChatResponseTurn as any)([
        new (ChatResponseMarkdownPart as any)(new (MarkdownString as any)('prior answer')),
      ]);
      await handler(
        { prompt: 'next', model: { id: 'mistral-large-latest' } },
        { history: [priorResponse] },
        { markdown: vi.fn(), progress: vi.fn() },
        { isCancellationRequested: false },
      );

      const [, messages] = mockProviderInstance.streamParticipantResponse.mock.calls[0];
      expect(messages[0].content).toBe('prior answer');
    });

    it('includes prior ChatResponseTurn2 as an Assistant message in history', async () => {
      const handler = await getHandler();

      const ChatResponseTurn2Ctor = (vscode as unknown as { ChatResponseTurn2?: new (...args: unknown[]) => unknown })
        .ChatResponseTurn2;
      expect(ChatResponseTurn2Ctor).toBeTypeOf('function');

      const priorResponseV2 = new (ChatResponseTurn2Ctor as any)([
        new (ChatResponseMarkdownPart as any)(new (MarkdownString as any)('prior v2 answer')),
      ]);
      await handler(
        { prompt: 'next', model: { id: 'mistral-large-latest' } },
        { history: [priorResponseV2] },
        { markdown: vi.fn() },
        { isCancellationRequested: false },
      );

      expect(mockProviderInstance.streamParticipantResponse).toHaveBeenCalledOnce();
      const [modelId, messages] = mockCalls[0] ?? [];
      const messageArray = messages ?? [];
      const firstMessage = messageArray[0];
      expect(firstMessage.content).toBe('prior v2 answer');
    });

    it('surfaces errors as a markdown message', async () => {
      const handler = await getHandler();

      const mockStream = { markdown: vi.fn(), progress: vi.fn() };
      mockProviderInstance.streamParticipantResponse.mockRejectedValueOnce(new Error('model unavailable'));

      await handler({ prompt: 'hi', model: { id: 'mistral-large-latest' } }, { history: [] }, mockStream, {
        isCancellationRequested: false,
      });

      expect(mockStream.markdown).toHaveBeenCalledWith(
        expect.stringContaining('An unexpected error occurred. Please check logs and try again.'),
      );
    });

    it('sanitizes error messages and hides sensitive details', async () => {
      const handler = await getHandler();

      const mockStream = { markdown: vi.fn() };
      const error = Object.assign(new Error('secret token leak'), { statusCode: 401 });
      mockProviderInstance.streamParticipantResponse.mockRejectedValueOnce(error);

      await handler({ prompt: 'test', model: { id: 'mistral-large-latest' } }, { history: [] }, mockStream, {
        isCancellationRequested: false,
      });

      // Should show user-friendly message for 401, not the raw error
      const callArg = mockStream.markdown.mock.calls[0][0];
      expect(callArg).toContain('API key');
      expect(callArg).not.toContain('secret token leak');
    });
  });

  describe('deactivate', () => {
    it('disposes active provider and returns undefined', () => {
      activate(mockContext);
      expect(deactivate()).toBeUndefined();
      expect(mockProviderInstance.dispose).toHaveBeenCalled();
    });
  });

  describe('additional coverage', () => {
    it('sets participant iconPath from Uri.joinPath', () => {
      const sentinel = { path: 'sentinel' } as unknown as vscode.Uri;
      (vscode.Uri.joinPath as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(sentinel);

      activate(mockContext);

      const createChatParticipantMock = chat.createChatParticipant as ReturnType<typeof vi.fn>;
      const mockResults = createChatParticipantMock.mock.results[0];
      const participantInstance = mockResults.value;
      expect(participantInstance.iconPath).toBe(sentinel);
    });

    it.each([
      [{ statusCode: 403 }, /Access denied/i],
      [{ statusCode: 429 }, /Rate limit exceeded/i],
      [{ statusCode: 503 }, /temporarily unavailable/i],
    ])('maps error %o to friendly message', async (error, expected) => {
      const [, handler] = (chat.createChatParticipant as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
      if (!handler) {
        activate(mockContext);
      }
      const getHandler = () =>
        (chat.createChatParticipant as ReturnType<typeof vi.fn>).mock.calls[0][1] as unknown as (
          ...args: unknown[]
        ) => Promise<void>;

      const stream = { markdown: vi.fn(), progress: vi.fn() };
      mockProviderInstance.streamParticipantResponse.mockRejectedValueOnce(error);

      await getHandler()(
        { prompt: 'x', model: { id: 'mistral' } },
        { history: [] },
        stream as unknown as vscode.ChatResponseStream,
        {
          isCancellationRequested: false,
        },
      );

      const msg = (stream.markdown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string | undefined;
      expect(msg).toMatch(expected);
    });
  });
});
