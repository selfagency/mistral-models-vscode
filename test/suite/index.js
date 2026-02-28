const path = require('path');

// Run Vitest programmatically inside the extension host to avoid spawning external CLI.
// This uses Vitest's Node API so tests run in-process under the VS Code test runner.
async function run() {
  const { spawn } = require('child_process');
  const workspaceRoot = path.resolve(__dirname, '..', '..');
  return new Promise((resolve, reject) => {
    // Run the project's test script (Vitest) in a child process so it doesn't interfere
    // with the extension host process environment. Capture output so failures are visible
    // in the extension host logs even when stdio behavior differs.
    const child = spawn('pnpm', ['run', 'test'], { cwd: workspaceRoot, shell: true });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      const s = String(chunk);
      stdout += s;
      process.stdout.write(s);
    });

    child.stderr.on('data', chunk => {
      const s = String(chunk);
      stderr += s;
      process.stderr.write(s);
    });

    child.on('error', err => reject(err));

    child.on('close', async code => {
      if (code !== 0) {
        // Include captured output in the rejection to help debugging in the extension host.
        const message = `Tests exited with code ${code}\n--- STDOUT ---\n${stdout}\n--- STDERR ---\n${stderr}`;
        return reject(new Error(message));
      }

      // After unit tests pass, run the extension-host integration tests inside this host.
      try {
        const extTest = require('./extension.test');
        if (typeof extTest === 'function') {
          await extTest();
        } else if (extTest && typeof extTest.default === 'function') {
          await extTest.default();
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Export in multiple ways to satisfy different loader expectations in the VS Code test harness.
module.exports = run;
module.exports.run = run;
exports.run = run;
