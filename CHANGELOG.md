# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Model Caching**: Implemented 30-minute TTL cache for model list to reduce API calls and improve performance
- **Friendly Error Messages**: User-friendly error handling for HTTP 401 (authentication), 429 (rate limiting), 500 (service errors), and network failures
- **Event Notifications**: Added `onDidChangeLanguageModelChatInformation` event firing when API key changes, enabling real-time model list updates in VS Code
- **VS Code 1.96+ Support**: Added `ChatResponseTurn2` support for forward compatibility with newer VS Code versions
- **Test Expansion**: Comprehensive integration test suite covering cache behavior, event management, tool call ID mapping, and model formatting (128 tests, 100% passing)
- **Agentsy package migration**: Switched runtime streaming imports from `@selfagency/llm-stream-parser` subpaths to the published split packages `@agentsy/normalizers` and `@agentsy/processor`
- **Per-model output token limits**: Added model-specific output token limits (mistral-large: 32768, codestral: 32768, mistral-medium: 8192, mistral-small: 4096, pixtral-large: 8192, magistral-medium: 8192, magistral-small: 4096) with fallback to 32768 for unknown models
- **TTFT tracking**: Added Time To First Token (TTFT) latency tracking for both chat completions and participant responses, logged to output channel and OpenTelemetry
- **Response classification**: Implemented response type classification (Success/Failed/RateLimited/QuotaExceeded/Canceled) for better error handling and retry eligibility
- **Exponential backoff retry**: Added retry wrapper with exponential backoff (1s, 2s, 4s, capped at 30s) for transient errors; never retries rate limit, quota exceeded, or auth errors
- **OpenTelemetry integration**: Added `@opentelemetry/api` dependency with span tracking for chat completions and participant responses, recording model info, usage (input/output tokens), and TTFT
- **Tool message validation**: Added tool message validation that strips orphaned tool results (results without matching tool calls) before sending to API, with warning logs

### Changed

- Improved tool call buffering in stream handler for more robust JSON parsing from LLM streams
- Enhanced error handling to distinguish between different failure scenarios (authentication, rate limiting, service availability)
- Optimized model caching with automatic expiry and manual reset on API key change
- Improved `ChatResponseTurn2` detection with type-safe helper function instead of fragile `as any` cast
- Removed `(vscode.Uri as any).joinPath` workaround; VS Code module resolution now works without cast

### Fixed

- Fixed Dependabot empty ecosystem configuration in GitHub Actions workflow
- Removed redundant tsup entry point configuration
- Reduced CI overhead by removing unnecessary xvfb-run setup for headless tests

### Deprecated

- Model refreshing now uses intelligent TTL caching instead of on-demand fetches
