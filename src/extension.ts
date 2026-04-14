import * as vscode from 'vscode';
import { MistralChatModelProvider } from './provider.js';

export function activate(context: vscode.ExtensionContext) {
  const logOutputChannel = vscode.window.createOutputChannel('Mistral Models', { log: true });

  const provider = new MistralChatModelProvider(context, logOutputChannel, true);
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
      const response = await request.model.sendRequest(messages, undefined, token);
      for await (const chunk of response.stream) {
        if (chunk instanceof vscode.LanguageModelTextPart) {
          stream.markdown(chunk.value);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      stream.markdown(`Error: ${message}`);
    }
  };

  const participant = vscode.chat.createChatParticipant('mistral-models-vscode.mistral', participantHandler);
  participant.iconPath = (
    vscode.Uri as unknown as { joinPath: (base: vscode.Uri, path: string) => vscode.Uri }
  ).joinPath(context.extensionUri, 'logo.png');
  context.subscriptions.push(participant);
}

export function deactivate() {}
