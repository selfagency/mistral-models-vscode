import * as vscode from 'vscode';
import { MistralChatModelProvider } from './provider.js';

/**
 * Map error objects to user-friendly messages, hiding sensitive details.
 */
function getUserFriendlyError(error: unknown): string {
  if (error && typeof error === 'object') {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number') {
      switch (statusCode) {
        case 401:
          return 'Invalid API key. Please check your Mistral API key configuration.';
        case 403:
          return 'Access denied. Please verify your API key has the required permissions.';
        case 429:
          return 'Rate limit exceeded. Please wait a moment and try again.';
        case 500:
        case 502:
        case 503:
          return 'Mistral service is temporarily unavailable. Please try again later.';
      }
    }
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return 'An unexpected error occurred. Check the output channel for details.';
}

export function activate(context: vscode.ExtensionContext) {
  const logOutputChannel = vscode.window.createOutputChannel('Mistral Models', { log: true });
  const usageStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  usageStatusBar.name = 'Mistral Usage';
  usageStatusBar.hide();

  const provider = new MistralChatModelProvider(context, logOutputChannel, true, usageStatusBar);
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('mistral', provider),
    vscode.commands.registerCommand('mistral-chat.manageApiKey', async () => {
      await provider.setApiKey();
    }),
    { dispose: () => provider.dispose() },
  );

  context.subscriptions.push(logOutputChannel, usageStatusBar);

  const participantHandler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> => {
    const messages: vscode.LanguageModelChatMessage[] = [];
    const maybeChatResponseTurn2Ctor =
      'ChatResponseTurn2' in vscode
        ? (vscode as unknown as { ChatResponseTurn2?: new (...args: unknown[]) => unknown }).ChatResponseTurn2
        : undefined;

    const extractResponseText = (responseParts: readonly unknown[]): string => {
      return responseParts
        .filter((r): r is vscode.ChatResponseMarkdownPart => r instanceof vscode.ChatResponseMarkdownPart)
        .map(r => r.value.value)
        .join('');
    };

    for (const turn of chatContext.history) {
      if (turn instanceof vscode.ChatRequestTurn) {
        messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
      } else if (turn instanceof vscode.ChatResponseTurn) {
        const text = extractResponseText(turn.response);
        if (text) {
          messages.push(vscode.LanguageModelChatMessage.Assistant(text));
        }
      } else if (maybeChatResponseTurn2Ctor && (turn as object) instanceof maybeChatResponseTurn2Ctor) {
        const responseParts = (turn as { response: readonly unknown[] }).response;
        const text = extractResponseText(responseParts);
        if (text) {
          messages.push(vscode.LanguageModelChatMessage.Assistant(text));
        }
      }
    }

    messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

    try {
      await provider.streamParticipantResponse(request.model?.id, messages, stream, token);
    } catch (error) {
      const userMessage = getUserFriendlyError(error);
      stream.markdown(`Error: ${userMessage}`);
      logOutputChannel.error(`[Mistral] Chat participant error: ${String(error)}`);
    }
  };

  const participant = vscode.chat.createChatParticipant('mistral-models-vscode.mistral', participantHandler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'logo.png');
  context.subscriptions.push(participant);
}

export function deactivate() {}
