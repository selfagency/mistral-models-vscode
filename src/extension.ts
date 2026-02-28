import * as vscode from 'vscode';
import { MistralChatModelProvider } from './provider';

export function activate(context: vscode.ExtensionContext) {
  // Create a log output channel for diagnostics (uses VS Code's logging API) when available.
  const logOutputChannel =
    typeof vscode.window.createOutputChannel === 'function'
      ? vscode.window.createOutputChannel('Mistral Models', { log: true })
      : undefined;

  const provider = new MistralChatModelProvider(context, logOutputChannel as any, true);
  // Register provider and command; push channel separately only when available so tests
  // that expect exactly two disposables don't break in mocks that lack createOutputChannel.
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('mistral', provider),
    vscode.commands.registerCommand('mistral-chat.manageApiKey', async () => {
      await provider.setApiKey();
    }),
  );

  if (logOutputChannel) {
    context.subscriptions.push(logOutputChannel);
  }
}

export function deactivate() {}
