import * as vscode from 'vscode';
import { MistralChatModelProvider } from './provider';

export function activate(context: vscode.ExtensionContext) {
	const provider = new MistralChatModelProvider(context);
	vscode.lm.registerLanguageModelChatProvider('mistral', provider);
	vscode.commands.registerCommand('mistral-chat.manageApiKey', async () => {
		await provider.setApiKey();
	});
}

export function deactivate() { }
