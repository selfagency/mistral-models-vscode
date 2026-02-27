import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lm, commands } from 'vscode';
import { activate, deactivate } from './extension';

vi.mock('./provider', () => ({
  MistralChatModelProvider: vi.fn().mockImplementation(function () {
    return { setApiKey: vi.fn() };
  }),
}));

describe('extension', () => {
  const mockContext = {
    subscriptions: { push: vi.fn() },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
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

    it('pushes exactly 2 disposables into context.subscriptions', () => {
      activate(mockContext);
      expect(mockContext.subscriptions.push).toHaveBeenCalledTimes(1);
      expect(mockContext.subscriptions.push.mock.calls[0]).toHaveLength(2);
    });
  });

  describe('deactivate', () => {
    it('returns undefined', () => {
      expect(deactivate()).toBeUndefined();
    });
  });
});
