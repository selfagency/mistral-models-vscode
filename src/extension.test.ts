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

const mockProviderInstance = {
  setApiKey: vi.fn(),
  dispose: vi.fn(),
  streamParticipantResponse: vi.fn().mockResolvedValue(undefined),
  _onDidChangeLanguageModelChatInformation: { fire: vi.fn(), dispose: vi.fn() },
};

vi.mock('./provider', () => ({
  MistralChatModelProvider: vi.fn().mockImplementation(function (
    _context: any,
    _logOutputChannel: any,
    _autoInit?: boolean,
    _statusBarItem?: any,
  ) {
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
      expect(mockContext.subscriptions.push.mock.calls[0]).toHaveLength(2);
    });

    it('creates output channel and tracks it in subscriptions', () => {
      activate(mockContext);
      expect(window.createOutputChannel).toHaveBeenCalledWith('Mistral Models', { log: true });
      expect(mockContext.subscriptions.push.mock.calls[1]).toHaveLength(1);
    });

    it('creates the @mistral chat participant', () => {
      activate(mockContext);
      expect(chat.createChatParticipant).toHaveBeenCalledWith('mistral-models-vscode.mistral', expect.any(Function));
    });

    it('pushes participant disposable into context.subscriptions', () => {
      activate(mockContext);
      // Third push call is the participant (after provider+command+dispose and output/status items)
      expect(mockContext.subscriptions.push).toHaveBeenCalledTimes(3);
      expect(mockContext.subscriptions.push.mock.calls[2]).toHaveLength(1);
    });
  });

  describe('activate — participant handler', () => {
    async function getHandler() {
      activate(mockContext);
      const [, handler] = (chat.createChatParticipant as ReturnType<typeof vi.fn>).mock.calls[0];
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
      const [modelId, messages] = mockProviderInstance.streamParticipantResponse.mock.calls[0];
      expect(modelId).toBe('mistral-large-latest');
      // Last message is the current prompt
      expect(messages.at(-1).content).toBe('hello');
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

      const [, messages] = mockProviderInstance.streamParticipantResponse.mock.calls[0];
      expect(messages[0].content).toBe('prior question');
      expect(messages[1].content).toBe('follow-up');
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
      const [, messages] = mockProviderInstance.streamParticipantResponse.mock.calls[0];
      expect(messages[0].content).toBe('prior v2 answer');
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
});
