const assert = require('assert');

/**
 * Minimal extension-host integration test.
 * This file runs inside the VS Code Extension Host process (loaded by test/suite/index.js).
 */
module.exports = async function () {
  // `vscode` is provided by the extension host.
  const vscode = require('vscode');

  // Ensure the command is registered
  const commands = await vscode.commands.getCommands(true);
  assert.ok(Array.isArray(commands), 'commands must be an array');
  if (!commands.includes('mistral-chat.manageApiKey')) {
    throw new Error('mistral-chat.manageApiKey command not registered');
  }
};
