# Mistral for Copilot

<p align="center">
  <img src="logo.png" alt="Mistral AI Logo" width="128" height="128">
</p>

<p align="center">
  <strong>Access Mistral AI models within GitHub Copilot Chat</strong>
</p>

<p align="center">
  <a href="https://mistral.ai">🌐 Mistral AI</a> •
  <a href="https://docs.mistral.ai/api">📖 API Docs</a> •
  <a href="https://console.mistral.ai/">🔑 Get API Key</a>
</p>

> **Forked from [OEvortex/vscode-mistral-copilot-chat](https://github.com/OEvortex/vscode-mistral-copilot-chat), which has been discontinued.**

## ✨ Features

- 🔍 **All Models** - Every Mistral chat-capable model fetched dynamically from the API; new releases appear automatically
- 💬 **Chat Participant** - Invoke `@mistral` directly in Copilot Chat for a dedicated, history-aware Mistral conversation
- 🔀 **Model Picker** - Also available via the model selector dropdown on any Copilot Chat conversation
- 🔧 **Tool Calling** - Function calling support for agentic workflows
- 🖼️ **Vision** - Image input support for models that support it
- 🔒 **Secure** - API key stored using VS Code's encrypted secrets API
- ⚡ **Streaming** - Real-time response streaming for faster interactions

## 🚀 Installation

1. **Install from VS Code Marketplace** (or install the `.vsix` file)
2. **Open Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. **Run:** `Mistral: Manage API Key`
4. **Enter your API key** from [console.mistral.ai](https://console.mistral.ai/)

## 🔑 Getting Your API Key

1. Go to [Mistral AI Console](https://console.mistral.ai/)
2. Sign up or log in with your account
3. Navigate to **API Keys** section
4. Click **Create new key**
5. Copy the key and paste it into VS Code when prompted

> 💡 **Tip:** Devstral models are currently free during the introductory period!

## 💬 Usage

### Chat Participant

Type `@mistral` in any Copilot Chat input to direct the conversation to Mistral AI. The participant is sticky — once invoked, it stays active for the thread.

```text
@mistral explain the architecture of this project
```

### Model Picker

To use a Mistral model in an existing Copilot Chat conversation without the `@mistral` handle:

1. Open **GitHub Copilot Chat** panel in VS Code
2. Click the **model selector** dropdown
3. Choose a **Mistral AI** model
4. Start chatting!

## 🔧 Requirements

- **VS Code** 1.104.0 or higher
- **GitHub Copilot Chat** extension installed
- A valid **Mistral AI API key**

## 🛡️ Privacy & Security

- Your API key is stored securely using VS Code's encrypted secrets API
- No data is stored by this extension - all requests go directly to Mistral AI
- See [Mistral AI Privacy Policy](https://mistral.ai/privacy) for details

## 🛠️ Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) (version pinned in `package.json`)
- [VS Code](https://code.visualstudio.com/) 1.104.0+

### Build

```bash
pnpm install
pnpm run compile        # type-check + lint + bundle
pnpm run watch          # parallel watch for type-check and bundle
```

### Testing

```bash
pnpm test               # unit tests (Vitest)
pnpm run test:coverage  # unit tests with coverage
pnpm run test:extension # VS Code integration tests
```

### Code Quality

Pre-commit hooks (husky + lint-staged) run oxlint and oxfmt automatically on staged `src/**/*.ts` files. No manual step needed — they activate on `git commit`.

### Debugging

Open the project in VS Code and press **F5** to launch the Extension Development Host with the extension loaded.

### CI/CD

- **Publish**: a GitHub Actions workflow packages and publishes the extension to the Visual Studio Marketplace on manual dispatch or version tag push.
- **Security**: CodeQL analysis runs on every push and pull request.

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

Forked from [OEvortex/vscode-mistral-copilot-chat](https://github.com/OEvortex/vscode-mistral-copilot-chat) by OEvortex.
Maintained by [Daniel Sieradski](https://self.agency) ([@selfagency](https://github.com/selfagency)).
