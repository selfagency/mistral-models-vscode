# Mistral AI for GitHub Copilot Chat

<p align="center">
  <img src="logo.png" alt="Mistral AI Logo" width="128" height="128">
</p>

<p align="center">
  <strong>Integrate Mistral AI's powerful language models directly into GitHub Copilot Chat</strong>
</p>

<p align="center">
  <a href="https://mistral.ai">🌐 Mistral AI</a> •
  <a href="https://docs.mistral.ai/api">📖 API Docs</a> •
  <a href="https://console.mistral.ai/">🔑 Get API Key</a>
</p>

---

## ✨ Features

- 🚀 **Agentic Coding Models** - Devstral 2 and Devstral Small 2 optimized for software engineering
- 🧠 **Flagship AI Models** - Access Mistral Large 3 (675B MoE) and Mistral Medium 3.1
- 💬 **Native Integration** - Works seamlessly with VS Code's GitHub Copilot Chat
- 🔧 **Tool Calling** - Function calling support for agentic workflows
- 🔒 **Secure** - API key stored using VS Code's encrypted secrets API
- ⚡ **Streaming** - Real-time response streaming for faster interactions
- 📦 **256k Context** - Process entire codebases with massive context windows

---

## 📦 Available Models

| Model | Context | Description | Best For |
|-------|---------|-------------|----------|
| **Devstral Small 2** | 256k tokens | Compact agentic coding model | Local deployment, efficient coding |
| **Devstral 2** | 256k tokens | Frontier agentic coding model | Complex software engineering tasks |
| **Mistral Large 3** | 256k tokens | 675B MoE flagship multimodal | General-purpose, vision, reasoning |
| **Mistral Medium 3.1** | 128k tokens | Frontier-class multimodal | Balanced performance & cost |

### Model Details

#### 🛠️ Devstral 2 (`devstral-latest`)
*Released December 2025*

Mistral's frontier code agents model designed for solving software engineering tasks. Features:
- 256,000 token context window
- Optimized for multi-file editing and codebase exploration
- Strong tool calling capabilities for agentic workflows
- Excels at understanding complex code dependencies

#### 🛠️ Devstral Small 2 (`devstral-small-latest`)
*Released December 2025*

A compact version optimized for local deployment:
- 256,000 token context window
- Efficient enough for consumer-grade hardware
- Same agentic capabilities in a smaller package

#### 🌟 Mistral Large 3 (`mistral-large-latest`)
*Released December 2025*

State-of-the-art flagship model with cutting-edge capabilities:
- 256,000 token context window
- 675 billion parameters (41B active) as Mixture-of-Experts
- Multimodal: understands both text and images
- Apache 2.0 licensed - open for commercial use
- Strong reasoning, coding, and multilingual support

#### ⚡ Mistral Medium 3.1 (`mistral-medium-latest`)
*Released August 2025*

Frontier-class model balancing performance and efficiency:
- 128,000 token context window
- Multimodal capabilities
- Ideal for high-complexity tasks

---

## 🚀 Installation

1. **Install from VS Code Marketplace** (or install the `.vsix` file)
2. **Open Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. **Run:** `Mistral: Manage API Key`
4. **Enter your API key** from [console.mistral.ai](https://console.mistral.ai/)

---

## 🔑 Getting Your API Key

1. Go to [Mistral AI Console](https://console.mistral.ai/)
2. Sign up or log in with your account
3. Navigate to **API Keys** section
4. Click **Create new key**
5. Copy the key and paste it into VS Code when prompted

> 💡 **Tip:** Devstral models are currently free during the introductory period!

---

## 💬 Usage

1. Open **GitHub Copilot Chat** panel in VS Code
2. Click the **model selector** dropdown
3. Choose a **Mistral AI** model:
   - `Devstral 2` for complex coding tasks
   - `Devstral Small 2` for efficient coding
   - `Mistral Large 3` for general-purpose tasks
   - `Mistral Medium 3.1` for balanced performance
4. Start chatting!

### Example Prompts

```
@workspace Explain the architecture of this project
```

```
Help me refactor this function to be more efficient
```

```
Write unit tests for the selected code
```

---

## 🔧 Requirements

- **VS Code** 1.104.0 or higher
- **GitHub Copilot Chat** extension installed
- A valid **Mistral AI API key**

---

## 🛡️ Privacy & Security

- Your API key is stored securely using VS Code's encrypted secrets API
- No data is stored by this extension - all requests go directly to Mistral AI
- See [Mistral AI Privacy Policy](https://mistral.ai/privacy) for details

---


## 📚 Resources

- [Mistral AI Documentation](https://docs.mistral.ai/)
- [Devstral 2 Model](https://docs.mistral.ai/models/devstral-2-25-12)
- [Mistral Large 3 Model](https://docs.mistral.ai/models/mistral-large-3-25-12)
- [Mistral Medium 3.1 Model](https://docs.mistral.ai/models/mistral-medium-3-1-25-08)
- [API Reference](https://docs.mistral.ai/api/)

---
## 📝 Changelog

### 0.1.0 (December 2025)
- Initial release with Devstral 2 and Devstral Small 2 models
- Added Mistral Large 3
- Implemented streaming chat completions
- Added tool calling support
- Secured API key storage

---
## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with ❤️ for developers by OEvortex (@OEvortex)
</p>