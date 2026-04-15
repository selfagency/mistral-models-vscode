'use strict';
const assert = require('assert');
const vscode = require('vscode');

suite('Extension Integration', () => {
  let extension;

  suiteSetup(async () => {
    // The activation event ('onLanguageModelChatProvider:mistral') doesn't fire
    // automatically in the test harness, so force-activate the extension.
    extension = vscode.extensions.getExtension('selfagency.mistral-models-vscode');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
  });

  test('extension is installed and active', () => {
    assert.ok(extension, 'Extension not found: selfagency.mistral-models-vscode');
    assert.strictEqual(extension.isActive, true, 'Extension is not active after activation');
  });

  test('manageApiKey command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('mistral-chat.manageApiKey'),
      'mistral-chat.manageApiKey command not registered'
    );
  });

  test('manifest contributes mistral language model provider wiring', () => {
    const packageJson = extension.packageJSON;
    assert.ok(packageJson?.contributes, 'Missing contributes block in package.json');

    const providers = packageJson.contributes.languageModelChatProviders || [];
    assert.ok(Array.isArray(providers) && providers.length > 0, 'No languageModelChatProviders contributed');
    const mistralProvider = providers.find((provider) => provider.vendor === 'mistral');
    assert.ok(mistralProvider, 'Missing contributed provider with vendor="mistral"');
    assert.strictEqual(
      mistralProvider.configuration?.managementCommand,
      'mistral-chat.manageApiKey',
      'Provider managementCommand is not wired to mistral-chat.manageApiKey'
    );
  });

  test('manifest contributes @mistral chat participant', () => {
    const packageJson = extension.packageJSON;
    const participants = packageJson?.contributes?.chatParticipants || [];
    assert.ok(Array.isArray(participants) && participants.length > 0, 'No chatParticipants contributed');

    const mistralParticipant = participants.find(
      (participant) => participant.id === 'mistral-models-vscode.mistral'
    );
    assert.ok(mistralParticipant, 'Missing @mistral chat participant contribution');
    assert.strictEqual(mistralParticipant.name, 'mistral', 'Unexpected chat participant name');
    assert.strictEqual(mistralParticipant.isSticky, true, 'Expected @mistral participant to be sticky');
  });
});
