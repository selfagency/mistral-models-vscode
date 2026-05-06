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
- **Agentsy package migration**: Switched runtime streaming imports from `@agentsy/core/*` subpaths to the published split packages `@agentsy/normalizers` and `@agentsy/processor`, while keeping `@agentsy/core` available as a supporting dependency for `@agentsy/vscode`
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
- Removed `@agentsy/core` from direct dependencies following upstream deprecation guidance; extension now depends only on published split packages `@agentsy/vscode`, `@agentsy/normalizers`, and `@agentsy/processor`
- Improved `ChatResponseTurn2` detection with type-safe helper function instead of fragile `as any` cast
- Removed `(vscode.Uri as any).joinPath` workaround; VS Code module resolution now works without cast

### Fixed

- Fixed Dependabot empty ecosystem configuration in GitHub Actions workflow
- Removed redundant tsup entry point configuration
- Reduced CI overhead by removing unnecessary xvfb-run setup for headless tests

### Deprecated

- Model refreshing now uses intelligent TTL caching instead of on-demand fetches

## [1.2.0] - 2026-04-15

## What's Changed
* chore(deps): bump picomatch from 2.3.1 to 2.3.2 in the npm_and_yarn group across 1 directory by @dependabot[bot] in https://github.com/selfagency/mistral-models-vscode/pull/7
* Complete comprehensive remediation plan (phases 1-5) + js-tiktoken/lite migration by @selfagency in https://github.com/selfagency/mistral-models-vscode/pull/9

## New Contributors
* @dependabot[bot] made their first contribution in https://github.com/selfagency/mistral-models-vscode/pull/7

**Full Changelog**: https://github.com/selfagency/mistral-models-vscode/compare/v1.1.0...v1.2.0

_Source: changes from v1.1.0 to v1.2.0._

## [1.1.0] - 2026-03-13

## What's Changed

* feat: integrate @selfagency/llm-stream-parser for thinking tag extraction by @selfagency in <https://github.com/selfagency/mistral-models-vscode/pull/6>

**Full Changelog**: <https://github.com/selfagency/mistral-models-vscode/compare/v1.0.9...v1.1.0>

_Source: changes from v1.0.9 to v1.1.0._

## [1.0.9] - 2026-03-05

## What's Changed

* fix: resolve model display and extension activation issues by @selfagency in <https://github.com/selfagency/mistral-models-vscode/pull/4>

**Full Changelog**: <https://github.com/selfagency/mistral-models-vscode/compare/v0.1.8...v1.0.9>

_Source: changes from v0.1.8 to v1.0.9._

## [0.1.8] - 2026-03-04

## What's Changed

* ui: show 'Mistral AI' in manage models detail by @selfagency in <https://github.com/selfagency/mistral-models-vscode/pull/3>
* ci: run tests on release tag pushes by @selfagency in <https://github.com/selfagency/mistral-models-vscode/pull/2>

**Full Changelog**: <https://github.com/selfagency/mistral-models-vscode/compare/v0.1.7...v0.1.8>

_Source: changes from v0.1.7 to v0.1.8._

## [0.1.7] - 2026-03-04

## What's Changed

* Show 'Mistral AI' in manage models dropdown by @selfagency in <https://github.com/selfagency/mistral-models-vscode/pull/1>

## New Contributors

* @selfagency made their first contribution in <https://github.com/selfagency/mistral-models-vscode/pull/1>

**Full Changelog**: <https://github.com/selfagency/mistral-models-vscode/compare/v0.1.6...v0.1.7>

_Source: changes from v0.1.6 to v0.1.7._

## [0.1.6] - 2026-03-01

**Full Changelog**: <https://github.com/selfagency/mistral-models-vscode/compare/v0.1.5...v0.1.6>

_Source: changes from v0.1.5 to v0.1.6._

## [0.1.5] - 2026-02-28

* Fixed extension bundling so dependencies are compiled into dist; removed pnpm/npm incompatibility in vsce publish
* Fixed release script: removed non-existent 'Remote Tests' workflow gate; fixed CHANGELOG insertion order
* Fixed release workflow: removed Tests-run SHA check that blocked releases when only metadata files changed

## [0.1.4] - 2026-02-28

* Forked archived project from <https://github.com/OEvortex/vscode-mistral-copilot-chat>
* Fixed failing tool calls
* Added support for all available Mistral models
* Added `@mistral` chat participant
* Added full test suite

## [0.1.3] - 2025-12-31

* Fixed API error with tool call IDs containing underscores - generate valid 9-character alphanumeric IDs when VS Code tool call IDs don't have an existing mapping

## [0.1.2] - 2025-12-23

* Added vision support for Devstral Small 2 model - can now process and analyze images
* Added tool call ID mapping system to ensure compatibility with VS Code's Language Model API
* Fixed tool call ID validation error - Mistral API returns IDs like `call_70312205` which don't meet VS Code's requirements for alphanumeric 9-character IDs. Now properly maps between Mistral and VS Code ID formats.

## [0.1.1] - Previous Release

* Integration with Mistral AI models including Devstral, Mistral Large
* GitHub Copilot Chat compatibility
* Tool calling support
* API key management
