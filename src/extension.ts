import * as vscode from 'vscode';
import { MistralChatModelProvider } from './provider.js';

let activeProvider: MistralChatModelProvider | undefined;

/**
 * Get ChatResponseTurn2 constructor if available (VS Code 1.96+)
 * Uses type-safe property access instead of fragile `as any` cast
 */
function getChatResponseTurn2Constructor(): typeof vscode.ChatResponseTurn | undefined {
  const vsCodeApi = vscode as unknown as Record<string, unknown>;
  if (typeof vsCodeApi.ChatResponseTurn2 === 'function') {
    return vsCodeApi.ChatResponseTurn2 as typeof vscode.ChatResponseTurn;
  }
  return undefined;
}

function getUserFriendlyError(error: unknown): string {
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { statusCode?: number }).statusCode
      : undefined;

  if (statusCode === 401) return 'Invalid API key. Please update your Mistral API key.';
  if (statusCode === 403) return 'Access denied. Please check API key permissions.';
  if (statusCode === 429) return 'Rate limit exceeded. Please wait a moment and try again.';
  if (statusCode !== undefined && statusCode >= 500) {
    return 'Mistral service is temporarily unavailable. Please try again later.';
  }

  return 'An unexpected error occurred. Please check logs and try again.';
}

export function activate(context: vscode.ExtensionContext) {
  const logOutputChannel = vscode.window.createOutputChannel('Mistral Models', {
    log: true,
  }) as vscode.LogOutputChannel;

  const provider = new MistralChatModelProvider(context, logOutputChannel, true);
  activeProvider = provider;
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('mistral', provider),
    vscode.commands.registerCommand('mistral-chat.manageApiKey', async () => {
      await provider.setApiKey();
    }),
  );

  if (logOutputChannel) {
    context.subscriptions.push(logOutputChannel);
  }

  const participantHandler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> => {
    const messages: vscode.LanguageModelChatMessage[] = [];

    // Get ChatResponseTurn2 constructor if available (VS Code 1.96+)
    const ChatResponseTurn2 = getChatResponseTurn2Constructor();

    for (const turn of chatContext.history) {
      if (turn instanceof vscode.ChatRequestTurn) {
        messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
      } else if (turn instanceof vscode.ChatResponseTurn) {
        const text = turn.response
          .filter((r): r is vscode.ChatResponseMarkdownPart => r instanceof vscode.ChatResponseMarkdownPart)
          .map(r => r.value.value)
          .join('');
        if (text) {
          messages.push(vscode.LanguageModelChatMessage.Assistant(text));
        }
      } else if (ChatResponseTurn2 && (turn as unknown) instanceof ChatResponseTurn2) {
        // Handle ChatResponseTurn2 (VS Code 1.96+)
        const response =
          typeof turn === 'object' && turn !== null && 'response' in turn
            ? ((turn as { response?: unknown }).response ?? [])
            : [];
        const responseParts = Array.isArray(response) ? response : [];
        const text = responseParts
          .filter((r): r is vscode.ChatResponseMarkdownPart => r instanceof vscode.ChatResponseMarkdownPart)
          .map(r => r.value.value)
          .join('');
        if (text) {
          messages.push(vscode.LanguageModelChatMessage.Assistant(text));
        }
      }
    }

    messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

    try {
      await provider.streamParticipantResponse(request.model?.id, messages, stream, token);
    } catch (error) {
      stream.markdown(`Error: ${getUserFriendlyError(error)}`);
    }
  };

  const participant = vscode.chat.createChatParticipant('mistral-models-vscode.mistral', participantHandler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'logo.png');
  context.subscriptions.push(participant);
}

export function deactivate() {
  activeProvider?.dispose();
  activeProvider = undefined;
}
