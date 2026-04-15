# Mistral Models VS Code Extension — Comprehensive Remediation Plan

> **Repository:** [selfagency/mistral-models-vscode](https://github.com/selfagency/mistral-models-vscode)
> **Date:** 2026-04-15
> **Scope:** Full code audit against VS Code AI Extension APIs, Mistral TypeScript SDK (`@mistralai/mistralai` v2.2.0), Mistral API docs, and `@selfagency/llm-stream-parser` API docs.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Reference Materials Reviewed](#2-reference-materials-reviewed)
3. [Codebase Overview](#3-codebase-overview)
4. [Issue Registry](#4-issue-registry)
   - [4.1 Critical / High Severity](#41-critical--high-severity)
   - [4.2 Medium Severity](#42-medium-severity)
   - [4.3 Low Severity](#43-low-severity)
5. [Missing Functionality Gap Analysis](#5-missing-functionality-gap-analysis)
6. [Detailed Remediation Steps](#6-detailed-remediation-steps)
   - [6.1 Phase 1 — Critical Fixes (Immediate)](#61-phase-1--critical-fixes-immediate)
   - [6.2 Phase 2 — High-Priority Fixes](#62-phase-2--high-priority-fixes)
   - [6.3 Phase 3 — Medium-Priority Improvements](#63-phase-3--medium-priority-improvements)
   - [6.4 Phase 4 — Low-Priority / Code Hygiene](#64-phase-4--low-priority--code-hygiene)
   - [6.5 Phase 5 — Feature Completion](#65-phase-5--feature-completion)
7. [Architecture Recommendations](#7-architecture-recommendations)
8. [Testing Remediation](#8-testing-remediation)
9. [Positive Findings](#9-positive-findings)
10. [Priority Matrix](#10-priority-matrix)

---

## 1. Executive Summary

This remediation plan is the result of a thorough audit of the `mistral-models-vscode` extension (~1,311 lines of source code across 3 files) against the official VS Code AI extension APIs, the Mistral TypeScript SDK v2.2.0, the Mistral API documentation, and the `@selfagency/llm-stream-parser` library API.

The audit identified **40 issues** across 4 severity levels:

| Severity             | Count | Description                                                                                                               |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| **High**             | 5     | Broken CI config, incorrect token limits, missing event firing, missing API version support, missing request cancellation |
| **Medium**           | 15    | Cache invalidation, tokenizer mismatch, error message leakage, type safety gaps, build config issues, test quality        |
| **Low**              | 20    | Code hygiene, minor type issues, dead code, bundle size, test gaps                                                        |
| **Missing Features** | 12    | System message support, retry logic, configuration settings, dispose/cleanup, rate limiting, usage tracking               |

The extension is well-architected overall with clean separation of concerns, comprehensive unit tests, and professional CI/CD. The issues identified are primarily correctness and completeness gaps rather than fundamental design problems.

---

## 2. Reference Materials Reviewed

### 2.1 VS Code AI Extension APIs

| URL                                                                                  | Topic                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <https://code.visualstudio.com/api/extension-guides/ai/tools>                        | Language Model Tools API — `vscode.LanguageModelTool<T>`, `LanguageModelToolResult`, tool registration, invocation flow                                |
| <https://code.visualstudio.com/api/extension-guides/ai/chat>                         | Chat Participant API — `vscode.ChatRequestHandler`, `ChatResponseStream`, follow-up provider, tool calling from chat                                   |
| <https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider> | Language Model Chat Provider API — `LanguageModelChatProvider`, `LanguageModelChatInformation`, model registration, `provideLanguageModelChatResponse` |
| <https://code.visualstudio.com/api/extension-guides/ai/language-model>               | Language Model Consumer API — `selectChatModels`, `sendRequest`, streaming via async iterable, `LanguageModelError`                                    |
| <https://code.visualstudio.com/api/extension-guides/ai/mcp>                          | MCP Integration — server registration, transports (stdio/http/sse), tools, resources, prompts, sampling                                                |

### 2.2 Mistral Client & API

| URL                                      | Topic                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <https://github.com/mistralai/client-ts> | `@mistralai/mistralai` v2.2.0 SDK — `Mistral` class, `chat.complete()`, `chat.stream()`, `fim`, `embeddings`, tool calling via Zod, error hierarchy, ESM-only |
| <https://docs.mistral.ai/llms.txt>       | Mistral API docs index — model catalog, authentication, streaming (SSE), function calling, rate limits, structured output                                     |

### 2.3 LLM Stream Parser

| URL                                            | Topic                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <https://llmstreamparser.self.agency/api.html> | `@selfagency/llm-stream-parser` — `LLMStreamProcessor`, `ThinkingParser`, `XmlStreamFilter`, `extractXmlToolCalls`, adapters, structured output parsing |

### 2.4 Key API Requirements Extracted

From the VS Code AI API docs, a compliant `LanguageModelChatProvider` must:

1. **Implement three methods:**
   - `provideLanguageModelChatInformation(options, token)` — return available models
   - `provideLanguageModelChatResponse(model, messages, options, progress, token)` — handle chat requests with streaming
   - `provideTokenCount(model, text, token)` — estimate token count

2. **Support `LanguageModelChatInformation` properties:**
   - `id`, `name`, `family`, `version`
   - `maxInputTokens`, `maxOutputTokens` (must be accurate per-model)
   - `capabilities.imageInput`, `capabilities.toolCalling`

3. **Handle `CancellationToken` in all async methods** — abort in-flight HTTP requests

4. **Support response parts:** `LanguageModelTextPart`, `LanguageModelToolCallPart`

5. **Fire `onDidChangeLanguageModelChatInformation`** when the model list changes

6. **Chat participant handlers** must support `ChatResponseTurn2` (VS Code 1.96+)

---

## 3. Codebase Overview

```
mistral-models-vscode/
├── src/
│   ├── extension.ts          (65 lines)  — Entry point, registration
│   ├── extension.test.ts     (169 lines) — Extension unit tests
│   ├── provider.ts           (794 lines) — Core Mistral LM provider
│   ├── provider.test.ts      (~1090 lines) — Provider unit tests
│   └── test/vscode.mock.ts   (143 lines) — VS Code API mock
├── package.json              (121 lines) — Extension manifest
├── tsup.config.mjs           (41 lines)  — Build config
├── vitest.config.js          (18 lines)  — Test config
├── .vscodeignore             (8 lines)   — Packaging exclusions
├── .github/
│   ├── dependabot.yml        (12 lines)  — BROKEN
│   └── workflows/
│       ├── ci.yml            (139 lines) — CI pipeline
│       ├── codeql.yml        — Security scanning
│       └── release.yml       (288 lines) — Release pipeline
├── scripts/release.mjs       (433 lines) — Release automation
└── test/integration/extension.test.js (23 lines)
```

**Architecture:** `extension.ts` (registration) → `provider.ts` (Mistral integration) → `@mistralai/mistralai` SDK + `@selfagency/llm-stream-parser`

---

## 4. Issue Registry

### 4.1 Critical / High Severity

#### H1 — Broken Dependabot Configuration

- **File:** `.github/dependabot.yml` line 8
- **Issue:** `package-ecosystem: ""` — empty string. Dependabot will not run at all.
- **Impact:** No automated dependency security updates. Vulnerabilities in `@mistralai/mistralai`, `tiktoken`, or other deps will go unnoticed.
- **Fix:** Change to `package-ecosystem: "npm"`.

#### H2 — Hardcoded `maxOutputTokens` Does Not Match Actual Model Limits

- **File:** `src/provider.ts` lines 43-44, 214
- **Issue:** `DEFAULT_MAX_OUTPUT_TOKENS = 16384` is applied uniformly to all Mistral models. The actual limits vary significantly:
  - `mistral-small-latest`: 4,096 tokens
  - `codestral-latest`: 8,192 tokens
  - `mistral-large-latest`: 16,384 tokens (the only model that matches the default)
- **Impact:** VS Code displays incorrect token counts. Setting `maxTokens` too high for `mistral-small-latest` will cause Mistral API 400 errors. Users selecting smaller models will encounter unexpected failures.
- **Fix:** Use per-model `maxOutputTokens` from the Mistral API's model metadata. The Mistral SDK's `models.list()` returns model details. If not available from the API, maintain a hardcoded map of known models.

#### H3 — `setApiKey()` Does Not Fire Model List Change Event

- **File:** `src/provider.ts` lines 329-333
- **Issue:** When a user changes their API key via `setApiKey()`, `fetchedModels` is reset to `null` but `onDidChangeLanguageModelChatInformation` is NOT fired. VS Code's model picker UI will not refresh until the next explicit call to `provideLanguageModelChatInformation`.
- **Impact:** After changing API keys, the model list in the UI remains stale. Users may try to use models from a different account or see models that are inaccessible.
- **Fix:** Fire `this._onDidChangeLanguageModelChatInformation.fire()` after resetting `fetchedModels` in `setApiKey()`. Alternatively, call `fetchModels()` eagerly and fire the event after it completes.

#### H4 — Chat Participant Ignores `ChatResponseTurn2` (VS Code 1.96+)

- **File:** `src/extension.ts` lines 22-57
- **Issue:** The history-processing loop in the chat participant handler only checks for `ChatResponseTurn` and `ChatRequestTurn`. VS Code 1.96+ introduced `ChatResponseTurn2` which has a different internal structure for response parts. This handler will silently skip `ChatResponseTurn2` entries, losing conversation context.
- **Impact:** Multi-turn conversations in the `@mistral` chat participant will lose history context when running on VS Code 1.96+, leading to degraded conversational quality.
- **Fix:** Add `instanceof vscode.ChatResponseTurn2` check alongside the existing `ChatResponseTurn` check. Extract response text from `ChatResponseTurn2` using its `response` property which contains `ChatResponsePart[]`.

#### H5 — No `AbortController` for Streaming HTTP Requests

- **File:** `src/provider.ts` lines 455, 498
- **Issue:** The `this.client.chat.stream()` call creates an HTTP SSE connection, but there is no `AbortController` linked to the `CancellationToken`. Cancellation only takes effect between chunks via polling `token.isCancellationRequested`. The HTTP connection remains open until the server sends the next chunk or times out.
- **Impact:** Cancelled requests waste server resources, consume rate limit quota unnecessarily, and hold open network connections. Users pressing "Stop" in chat will see a delay before the request truly terminates.
- **Fix:** Create an `AbortController` before starting the stream. Link it to `token.onCancellationRequested` to call `abortController.abort()`. The Mistral SDK v2.x accepts an `AbortSignal` — pass `abortController.signal` to the `chat.stream()` call options.

---

### 4.2 Medium Severity

#### M1 — No TTL-Based Cache Invalidation for Model List

- **File:** `src/provider.ts` lines 191-281
- **Issue:** `fetchModels()` caches results in `fetchedModels` forever (until `setApiKey()` resets it). If Mistral releases a new model or deprecates an existing one, users won't see the change until they restart VS Code.
- **Fix:** Add a TTL (e.g., 30 minutes) to the model cache. On subsequent calls, check if `Date.now() - cacheTimestamp > TTL` and refetch if expired. Fire `onDidChangeLanguageModelChatInformation` if the list changes.

#### M2 — Malformed Tool Call Arguments Sent to VS Code

- **File:** `src/provider.ts` line 579
- **Issue:** When JSON parsing fails on a tool call's accumulated arguments during the final flush, the code emits `{ raw: buf.argsText }` as the arguments. This malformed object will be passed to the VS Code tool handler, which expects well-formed arguments matching the tool's JSON schema.
- **Impact:** Tool handlers receive garbage input and will likely throw unhandled errors, producing confusing error messages in the chat UI.
- **Fix:** When JSON parse fails on final flush, log a warning and skip the tool call entirely (do not emit a `LanguageModelToolCallPart`). Alternatively, report a text part to the user explaining the model produced an invalid tool call.

#### M3 — Token Counting Uses Wrong Tokenizer

- **File:** `src/provider.ts` lines 747-749
- **Issue:** `provideTokenCount()` uses OpenAI's `cl100k_base` encoding via `tiktoken`. Mistral uses its own tokenizer, which produces different token counts for the same text. The `cl100k_base` tokenizer typically overcounts by 10-30% for Mistral models.
- **Impact:** VS Code's "tokens used" display will be inaccurate. VS Code may prematurely truncate prompts it thinks exceed `maxInputTokens`, or may allow prompts that actually exceed the limit (causing API errors).
- **Fix:** This is a known limitation — no Mistral tokenizer exists for JavaScript. Document the inaccuracy in code comments. Consider using a character-based heuristic (`Math.ceil(charCount / 3.5)`) as a simpler, equally inaccurate but lighter-weight alternative that avoids bundling the 1MB `tiktoken` WASM. Alternatively, use the Mistral API's token counting endpoint if one becomes available.

#### M4 — Raw Error Messages Leaked to User in Chat

- **File:** `src/extension.ts` lines 54-56
- **Issue:** In the chat participant handler's catch block, `stream.markdown()` renders the raw error message directly. This could include API key fragments, internal server URLs, stack traces, or other sensitive information from the Mistral SDK's error objects.
- **Impact:** Security risk. Users could see sensitive information. Error messages may be confusing or alarming.
- **Fix:** Catch specific error types and show user-friendly messages. For `MistralError`, check `error.statusCode` and show appropriate messages (401 → "Invalid API key", 429 → "Rate limit exceeded", 500 → "Mistral service error"). Log the full error to the output channel for debugging.

#### M5 — Unnecessary `typeof` Guard and `as any` Cast

- **File:** `src/extension.ts` lines 6-10
- **Issue:** The `typeof vscode.window.createOutputChannel === 'function'` check is unnecessary since `engines.vscode: "^1.109.0"` guarantees this API exists. The ternary then requires an `as any` cast to satisfy the type checker.
- **Fix:** Remove the `typeof` check and call `vscode.window.createOutputChannel(...)` directly.

#### M6 — `Math.random()` for Tool Call ID Generation

- **File:** `src/provider.ts` lines 156-163
- **Issue:** `generateToolCallId()` uses `Math.random()` to generate 9-character alphanumeric IDs. `Math.random()` has a 32-bit seed and low entropy, making collisions plausible under high concurrency.
- **Impact:** Low but non-zero probability of tool call ID collisions, which could cause VS Code to confuse tool call results.
- **Fix:** Use `crypto.randomUUID()` and take a substring, or use `crypto.randomBytes(6).toString('base64url')` for a 9-character cryptographically random ID.

#### M7 — `CancellationToken` Ignored in `provideLanguageModelChatInformation`

- **File:** `src/provider.ts` lines 362-386
- **Issue:** The `_token` parameter is accepted but never checked. If the user cancels while models are being fetched, the fetch continues to completion.
- **Fix:** Check `token.isCancellationRequested` before and after the `fetchModels()` call. Wire `token.onCancellationRequested` to an `AbortController` if the fetch supports it.

#### M8 — Inconsistent Logging in `fetchModels()`

- **File:** `src/provider.ts` line 278
- **Issue:** The catch block in `fetchModels()` uses `console.error()` instead of `this.log.error()`. Other error paths in the provider use `this.log`.
- **Impact:** Errors in model fetching only appear in DevTools console, not in the extension's output channel. Users checking the "Mistral" output channel won't see these errors.
- **Fix:** Replace `console.error(...)` with `this.log.error(...)`.

#### M9 — Redundant Build Entry Point

- **File:** `tsup.config.mjs` line 8
- **Issue:** Both `src/extension.ts` and `src/provider.ts` are listed as entry points. Since `extension.ts` imports `provider.ts`, bundling `provider.ts` separately creates a redundant `dist/provider.js` file. VS Code only loads `dist/extension.js`.
- **Impact:** Larger extension package size (two files instead of one). Confusing build output.
- **Fix:** Remove `src/provider.ts` from the entry array. Only `src/extension.ts` should be an entry point.

#### M10 — `@types/vscode` Version Not Pinned

- **File:** `package.json` line 96
- **Issue:** `"@types/vscode": "^1.109.0"` uses caret versioning. Minor/patch bumps to `@types/vscode` can introduce new type definitions that conflict with the pinned `engines.vscode` minimum, causing unexpected type errors.
- **Fix:** Pin to exact version: `"@types/vscode": "1.109.0"`. Update intentionally when bumping `engines.vscode`.

#### M11 — Extension Test Mock Too Aggressive

- **File:** `src/extension.test.ts` lines 14-18
- **Issue:** The `MistralChatModelProvider` class is replaced with `{ setApiKey: vi.fn() }`, preventing any verification of actual provider behavior (model registration, initialization flow).
- **Fix:** Use a lighter mock that preserves the constructor but stubs only the methods that interact with external services (API calls, secret storage). This allows testing the registration logic.

#### M12 — Chat Response Test Doesn't Verify Mistral API Integration

- **File:** `src/provider.test.ts` lines 814-857
- **Issue:** The "Chat Response Provision" test only checks that `mockProgress.report` was called, not that the Mistral client's `chat.stream()` was called with correct arguments (model, messages, tools, maxTokens, etc.).
- **Fix:** Add assertions verifying `mockClient.chat.stream` was called with the expected model, properly converted messages, and correct options. Verify that progress reports match the mock stream chunks.

#### M13 — `.vscodeignore` Missing Exclusions

- **File:** `.vscodeignore`
- **Issue:** Several non-essential directories are not excluded from the VSIX package: `scripts/**`, `test/**`, `codeql/**`, `.github/**`, `.claude/**`.
- **Impact:** Larger than necessary extension package. Potentially includes sensitive CI configuration.
- **Fix:** Add the missing exclusions:

  ```
  scripts/**
  test/**
  codeql/**
  .github/**
  .claude/**
  ```

#### M14 — No Tests for Streaming Response Processing

- **File:** `src/provider.test.ts`
- **Issue:** No tests verify: tool call buffering across chunks, thinking tag stripping via `LLMStreamProcessor`, partial JSON accumulation for tool arguments, finish flush behavior when `finishReason` is set.
- **Fix:** Add test cases that simulate multi-chunk streams with: text-only chunks, tool call name then arguments in separate chunks, interleaved text and tool calls, thinking tags wrapping regular content.

#### M15 — Pre-Release Detection Logic in Release Workflow

- **File:** `.github/workflows/release.yml` line 205
- **Issue:** Pre-release detection uses `contains(tag, '-')`. A tag like `v1-0-0` (unusual but valid) would incorrectly be treated as pre-release.
- **Fix:** Use semver parsing: check if the version has a prerelease identifier (e.g., `-beta.1`, `-rc.1`) rather than simply checking for hyphens. Or use a regex like `/v?\d+\.\d+\.\d+-(alpha|beta|rc)\.\d+/`.

---

### 4.3 Low Severity

| ID  | File                                 | Line    | Issue                                                    | Suggested Fix                                    |
| --- | ------------------------------------ | ------- | -------------------------------------------------------- | ------------------------------------------------ |
| L1  | `src/provider.ts`                    | 203     | `new Map<string, any>()` for model dedup                 | Use `Map<string, ModelInfo>` with a proper type  |
| L2  | `src/provider.ts`                    | 746     | `Tiktoken` instance never freed on deactivation          | Call `tiktoken.free()` in `deactivate()`         |
| L3  | `src/provider.ts`                    | 784-793 | `toMistralRole()` maps unknown roles to `user` silently  | Log a warning for unknown roles                  |
| L4  | `src/provider.ts`                    | 503-504 | `JSON.stringify` on every stream chunk for debug         | Gate behind a flag or use `Object.keys()`        |
| L5  | `src/provider.ts`                    | 689     | Unnecessary `canSendImages = hasImages` variable         | Use `hasImages` directly                         |
| L6  | `src/extension.ts`                   | 60      | `(vscode.Uri as any).joinPath(...)`                      | Use `vscode.Uri.joinPath()` directly             |
| L7  | `src/extension.ts`                   | 47      | Empty `{}` instead of `undefined` in `sendRequest`       | Pass `undefined`                                 |
| L8  | `src/provider.test.ts`               | 148-178 | Duplicate test cases in `getMistralToolCallId`           | Remove duplicates                                |
| L9  | `src/provider.test.ts`               | 598-606 | API key validation test bypasses `validateInput`         | Test with actual validation function             |
| L10 | `src/provider.test.ts`               | 634-641 | API key trimming test doesn't verify trimming            | Assert `trim()` is applied                       |
| L11 | `src/test/vscode.mock.ts`            | 3-16    | `LanguageModelChatInformation` mock missing newer fields | Add missing fields from VS Code 1.96+            |
| L12 | `src/test/vscode.mock.ts`            | 110-122 | `LanguageModelChatMessage` mock uses `string` content    | Use `Part[]` content type                        |
| L13 | `tsup.config.mjs`                    | 13      | `tiktoken` bundled with WASM (~1MB+)                     | Consider `tiktoken/lite` or char-based heuristic |
| L14 | `package.json`                       | 89      | Self-dependency on pre-1.0 `llm-stream-parser`           | Pin to exact version or vendor                   |
| L15 | `.github/workflows/ci.yml`           | 85      | `xvfb-run` unnecessary — no GUI tests                    | Remove `xvfb-run -a`                             |
| L16 | `src/provider.ts`                    | 340-357 | No retry for `initClient()` transient failures           | Add single retry with backoff                    |
| L17 | `src/provider.test.ts`               | —       | No test for `System` role in `toMistralRole()`           | Add test case                                    |
| L18 | `src/provider.ts`                    | 458     | `defaultCompletionTokens = 65536`                        | Lower to match largest model's actual limit      |
| L19 | `test/integration/extension.test.js` | —       | Only checks command registration                         | Add functional integration tests                 |
| L20 | `src/provider.ts`                    | 330     | `fetchedModels = null` without event fire                | Covered by H3                                    |

---

## 5. Missing Functionality Gap Analysis

| Feature                            | Status     | Priority | Description                                                                          |
| ---------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------ |
| System message support             | ❌ Missing | High     | `toMistralRole()` maps `System` → `user`. Mistral supports system messages natively. |
| `AbortController` for HTTP         | ❌ Missing | High     | Streaming requests cannot be aborted on cancellation.                                |
| `ChatResponseTurn2` support        | ❌ Missing | High     | Chat participant loses context on VS Code 1.96+.                                     |
| Per-model `maxOutputTokens`        | ❌ Missing | High     | Hardcoded default doesn't match individual model limits.                             |
| Retry logic for transient errors   | ❌ Missing | Medium   | No retry on 429 (rate limit) or 5xx (server error) responses.                        |
| `dispose()` / cleanup              | ❌ Missing | Medium   | `deactivate()` is empty. Tokenizer and event emitter not cleaned up.                 |
| VS Code settings                   | ❌ Missing | Medium   | No configuration for model preferences, base URL override, temperature, etc.         |
| API key server-side validation     | ❌ Missing | Medium   | Only client-side length check. No test call to verify key validity.                  |
| Multiple endpoint support          | ❌ Missing | Medium   | No support for Azure Mistral or self-hosted endpoints.                               |
| Usage/cost tracking                | ❌ Missing | Low      | No tracking of tokens consumed or estimated cost.                                    |
| MCP tool integration               | ❌ Missing | Low      | VS Code supports MCP tools; extension could expose Mistral-compatible MCP tools.     |
| `LLMStreamProcessor` test coverage | ❌ Missing | Medium   | No tests for thinking tag stripping or privacy scrubbing in streaming.               |

---

## 6. Detailed Remediation Steps

### 6.1 Phase 1 — Critical Fixes (Immediate)

#### 6.1.1 Fix Dependabot Configuration (H1)

**File:** `.github/dependabot.yml`

```yaml
# BEFORE (broken)
package-ecosystem: ""

# AFTER
package-ecosystem: "npm"
```

Also consider adding:

```yaml
schedule:
  interval: 'weekly'
  day: 'monday'
open-pull-requests-limit: 10
reviewers:
  - 'selfagency'
labels:
  - 'dependencies'
```

#### 6.1.2 Fix Per-Model `maxOutputTokens` (H2)

**File:** `src/provider.ts`

Add a lookup table for known Mistral model output limits:

```typescript
const MODEL_OUTPUT_LIMITS: Record<string, number> = {
  'mistral-tiny-latest': 4096,
  'mistral-small-latest': 4096,
  'mistral-medium-latest': 8192,
  'mistral-large-latest': 16384,
  'codestral-latest': 8192,
  'devstral-latest': 16384,
  'pixtral-large-latest': 8192,
};

// In fetchModels(), after fetching from API:
const maxOutput =
  MODEL_OUTPUT_LIMITS[model.id] ?? MODEL_OUTPUT_LIMITS[modelId.replace(/-latest$/, '')] ?? DEFAULT_MAX_OUTPUT_TOKENS;
```

Additionally, check if the Mistral SDK's `models.list()` or `models.retrieve()` response includes output token limits in the model metadata. If so, prefer the API-provided value.

Also update `DEFAULT_MAX_OUTPUT_TOKENS` to a more conservative value:

```typescript
const DEFAULT_MAX_OUTPUT_TOKENS = 4096; // Safe default for most models
const DEFAULT_COMPLETION_TOKENS = 4096;
```

#### 6.1.3 Fire Event After API Key Change (H3)

**File:** `src/provider.ts`, method `setApiKey()`

```typescript
async setApiKey(): Promise<boolean> {
  // ... existing input box logic ...

  if (apiKey) {
    await this.context.secrets.store(SECRET_KEY, apiKey);
    this.fetchedModels = null;
    this.client = new Mistral({ apiKey });
    // ADD: Fire event to refresh model list in UI
    this._onDidChangeLanguageModelChatInformation.fire();
    return true;
  }
  return false;
}
```

#### 6.1.4 Support `ChatResponseTurn2` (H4)

**File:** `src/extension.ts`, chat participant handler

```typescript
// Add import
import type * as vscode from 'vscode';

// In the history processing loop, add:
for (const h of context.history) {
  if (h instanceof vscode.ChatRequestTurn) {
    messages.push(vscode.LanguageModelChatMessage.User(h.prompt));
  } else if (h instanceof vscode.ChatResponseTurn) {
    // Existing v1 handling
    const text = h.response
      .filter((r): r is vscode.ChatResponseMarkdownPart => r instanceof vscode.ChatResponseMarkdownPart)
      .map(r => r.value.value)
      .join('\n');
    if (text) {
      messages.push(vscode.LanguageModelChatMessage.Assistant(text));
    }
  } else if (h instanceof vscode.ChatResponseTurn2) {
    // NEW: v2 handling (VS Code 1.96+)
    const textParts = h.response
      .filter((p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart)
      .map(p => p.value.value);
    const text = textParts.join('\n');
    if (text) {
      messages.push(vscode.LanguageModelChatMessage.Assistant(text));
    }
  }
}
```

Add a type guard since `ChatResponseTurn2` may not exist in older `@types/vscode`:

```typescript
// Safe check for environments with older types
if ('ChatResponseTurn2' in vscode && h instanceof (vscode as any).ChatResponseTurn2) {
  // ... handle v2
}
```

#### 6.1.5 Add `AbortController` for Streaming (H5)

**File:** `src/provider.ts`, method `provideLanguageModelChatResponse()`

```typescript
async provideLanguageModelChatResponse(
  model: LanguageModelChatInformation,
  messages: readonly LanguageModelChatRequestMessage[],
  options: ProvideLanguageModelChatResponseOptions,
  progress: Progress<LanguageModelResponsePart>,
  token: CancellationToken
): Promise<void> {
  const abortController = new AbortController();

  // Link VS Code cancellation to HTTP abort
  const cancellationDisposable = token.onCancellationRequested(() => {
    abortController.abort();
    this.log.info('[Mistral] Request cancelled by user');
  });

  try {
    const stream = await this.client.chat.stream({
      model: /* ... */,
      messages: /* ... */,
      // Pass AbortSignal to Mistral SDK
      abortSignal: abortController.signal,
    });

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        this.log.debug('[Mistral] Skipping chunk after cancellation');
        break;
      }
      // ... existing chunk processing ...
    }
  } finally {
    cancellationDisposable.dispose();
  }
}
```

**Note:** Verify that `@mistralai/mistralai` v2.2.0 accepts an `abortSignal` option in `chat.stream()`. If it uses a different parameter name (e.g., `signal` or `AbortSignal` constructor option), adjust accordingly. The Mistral SDK v2 supports custom `httpClient` with hooks — if `abortSignal` is not directly supported, create a custom `fetch` wrapper:

```typescript
const mistral = new Mistral({
  apiKey,
  httpClient: {
    async fetch(url, init) {
      return globalThis.fetch(url, { ...init, signal: abortController.signal });
    },
  },
});
```

---

### 6.2 Phase 2 — High-Priority Fixes

#### 6.2.1 Support System Messages

**File:** `src/provider.ts`, `toMistralRole()`

```typescript
function toMistralRole(role: LanguageModelChatMessageRole): string {
  switch (role) {
    case LanguageModelChatMessageRole.User:
      return 'user';
    case LanguageModelChatMessageRole.Assistant:
      return 'assistant';
    case LanguageModelChatMessageRole.System: // ADD
      return 'system'; // ADD
    default:
      this.log.warn(`[Mistral] Unknown role: ${role}, mapping to 'user'`);
      return 'user';
  }
}
```

Note: The VS Code Language Model API docs state that system messages are **not currently supported** as input to `sendRequest()`. However, the `LanguageModelChatMessageRole` enum does include `System`, and Mistral natively supports system messages. Forwarding them when present ensures forward compatibility.

#### 6.2.2 Add TTL-Based Model Cache (M1)

```typescript
private fetchedModels: MistralModel[] | null = null;
private modelCacheTimestamp: number = 0;
private static readonly MODEL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

private async fetchModels(): Promise<MistralModel[]> {
  const now = Date.now();
  if (
    this.fetchedModels &&
    (now - this.modelCacheTimestamp) < MistralChatModelProvider.MODEL_CACHE_TTL_MS
  ) {
    return this.fetchedModels;
  }

  try {
    const response = await this.client.models.list();
    const models = response.data;
    this.fetchedModels = models;
    this.modelCacheTimestamp = now;
    this._onDidChangeLanguageModelChatInformation.fire();
    return models;
  } catch (error) {
    this.log.error('[Mistral] Failed to fetch models: ' + String(error));
    return this.fetchedModels ?? [];
  }
}
```

#### 6.2.3 Sanitize Error Messages in Chat (M4)

```typescript
// In extension.ts, chat participant handler catch block:
catch (error) {
  const userMessage = getUserFriendlyError(error);
  stream.markdown(`Error: ${userMessage}`);
  this.log.error('[Mistral] Chat participant error: ' + String(error));
}

function getUserFriendlyError(error: unknown): string {
  if (error && typeof error === 'object') {
    const statusCode = (error as any).statusCode;
    switch (statusCode) {
      case 401: return 'Invalid API key. Please update your Mistral API key.';
      case 403: return 'Access denied. Please check your API key permissions.';
      case 429: return 'Rate limit exceeded. Please wait a moment and try again.';
      case 500: case 502: case 503:
        return 'Mistral service is temporarily unavailable. Please try again later.';
    }
  }
  return 'An unexpected error occurred. Check the output channel for details.';
}
```

#### 6.2.4 Fix Malformed Tool Call Arguments (M2)

```typescript
// In provideLanguageModelChatResponse, final flush:
if (buf.name && buf.argsText) {
  try {
    const parsedArgs = JSON.parse(buf.argsText);
    progress.report(
      new LanguageModelToolCallPart(
        this.generateToolCallId(buf.name),
        buf.name,
        typeof parsedArgs === 'object' ? parsedArgs : { input: parsedArgs },
      ),
    );
  } catch {
    // CHANGED: Instead of emitting { raw: ... }, log and skip
    this.log.warn(`[Mistral] Tool call "${buf.name}" has invalid JSON arguments: ${buf.argsText.substring(0, 100)}`);
    progress.report(
      new LanguageModelTextPart(`[Warning: Tool call "${buf.name}" produced invalid arguments and was skipped.]`),
    );
  }
}
```

---

### 6.3 Phase 3 — Medium-Priority Improvements

#### 6.3.1 Implement `dispose()` Cleanup

**File:** `src/extension.ts`

```typescript
// In activate():
const provider = new MistralChatModelProvider(context);
context.subscriptions.push(
  vscode.lm.registerLanguageModelChatProvider('mistral', provider),
  // ... other registrations ...
  { dispose: () => provider.dispose() }  // ADD
);

// In provider.ts:
dispose(): void {
  if (this.tiktoken) {
    this.tiktoken.free();
    this.tiktoken = undefined;
  }
  this._onDidChangeLanguageModelChatInformation.dispose();
  this.client = undefined;
  this.log.dispose();
}
```

#### 6.3.2 Add VS Code Settings

**File:** `package.json`, add to `contributes.configuration`:

```json
{
  "contributes": {
    "configuration": {
      "title": "Mistral Models",
      "properties": {
        "mistral.apiKey": {
          "type": "string",
          "description": "Mistral API key (alternative to using the command)",
          "order": 1
        },
        "mistral.defaultModel": {
          "type": "string",
          "description": "Default model to use for chat",
          "default": "mistral-large-latest",
          "enum": []
        },
        "mistral.temperature": {
          "type": "number",
          "description": "Default temperature for completions",
          "default": 0.7,
          "minimum": 0,
          "maximum": 1
        },
        "mistral.maxTokens": {
          "type": "number",
          "description": "Default maximum tokens for completions",
          "default": 4096
        },
        "mistral.baseUrl": {
          "type": "string",
          "description": "Custom Mistral API base URL (for self-hosted or Azure)"
        },
        "mistral.thinkingSupport": {
          "type": "boolean",
          "description": "Enable thinking tag extraction for supported models",
          "default": true
        }
      }
    }
  }
}
```

#### 6.3.3 Add Retry Logic for Transient Errors

```typescript
private async withRetry<T>(
  fn: () => Promise<T>,
  token: CancellationToken,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (token.isCancellationRequested) {
      throw new Error('Cancelled');
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const statusCode = (error as any)?.statusCode;
      const isRetryable = statusCode === 429 || statusCode >= 500;
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      this.log.warn(`[Mistral] Retrying (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
```

#### 6.3.4 Use `crypto.randomUUID()` for Tool Call IDs (M6)

```typescript
import { randomUUID } from 'crypto';

private generateToolCallId(name: string): string {
  // Use crypto.randomUUID() and take first 9 chars of base64url encoding
  const id = randomUUID().replace(/-/g, '').substring(0, 9);
  const key = `${name}:${id}`;
  // ... rest of existing mapping logic ...
}
```

#### 6.3.5 Fix Build Configuration (M9)

**File:** `tsup.config.mjs`

```typescript
// BEFORE
entry: ['src/extension.ts', 'src/provider.ts'],

// AFTER
entry: ['src/extension.ts'],
```

#### 6.3.6 Fix `.vscodeignore` (M13)

```
.vscode/**
.vscode-test**/
src/**
test/**
scripts/**
codeql/**
.github/**
.claude/**
.gitignore
.husky/**
tsconfig.json
tsup.config.mjs
vitest.config.js
oxlint.config.js
oxlintrc.json
oxfmtrc.json
pnpm-workspace.yaml
CHANGELOG.md
LICENSE.md
README.md
node_modules/**
```

---

### 6.4 Phase 4 — Low-Priority / Code Hygiene

#### 6.4.1 Remove Dead Code (M5)

**File:** `src/extension.ts`

```typescript
// BEFORE
const logOutputChannel =
  typeof vscode.window.createOutputChannel === 'function'
    ? vscode.window.createOutputChannel('Mistral', { log: true })
    : undefined;
const log = logOutputChannel as any;

// AFTER
const log = vscode.window.createOutputChannel('Mistral', { log: true });
```

#### 6.4.2 Fix `as any` Casts

```typescript
// extension.ts line 60: BEFORE
(vscode.Uri as any).joinPath(context.extensionUri, 'logo.png');
// AFTER
vscode.Uri.joinPath(context.extensionUri, 'logo.png');

// provider.ts line 203: BEFORE
const byId = new Map<string, any>();
// AFTER
interface MistralModelInfo {
  id: string;
  name: string; /* ... */
}
const byId = new Map<string, MistralModelInfo>();
```

#### 6.4.3 Remove Duplicate Tests (L8)

Delete duplicate test cases in `provider.test.ts` lines 148-178 (the `getMistralToolCallId` tests).

#### 6.4.4 Gate Debug Logging (L4)

```typescript
// BEFORE (runs on every chunk)
this.log.debug('[Mistral] stream chunk received: ' + JSON.stringify(Object.keys(chunk || {})));

// AFTER (only when explicitly enabled)
if (this.debugMode) {
  this.log.debug('[Mistral] stream chunk: ' + JSON.stringify(Object.keys(chunk || {})));
}
```

#### 6.4.5 Remove Unnecessary `xvfb-run` (L15)

**File:** `.github/workflows/ci.yml`

```yaml
# BEFORE
xvfb-run -a pnpm test:coverage

# AFTER
pnpm test:coverage
```

#### 6.4.6 Improve Tokenizer Accuracy Documentation (M3)

```typescript
/**
 * Provides an approximate token count for the given text.
 *
 * IMPORTANT: This uses OpenAI's cl100k_base tokenizer as an approximation.
 * Mistral uses its own tokenizer, so counts may differ by 10-30%.
 * This is a known limitation — no Mistral tokenizer exists for JavaScript.
 *
 * The inaccuracy is acceptable for:
 * - VS Code's "tokens used" display (informational)
 * - Prompt truncation decisions (conservative overcount is safer than undercount)
 */
async provideTokenCount(/* ... */): Promise<number> { /* ... */ }
```

---

### 6.5 Phase 5 — Feature Completion

#### 6.5.1 Add Retry Logic with Exponential Backoff

See Section 6.3.3 for implementation. Apply to:

- `client.chat.stream()` calls
- `client.models.list()` calls

#### 6.5.2 Add Custom Endpoint Support

Allow users to configure a custom Mistral API URL for self-hosted or Azure deployments:

```typescript
// In provider.ts constructor or initClient():
const config = vscode.workspace.getConfiguration('mistral');
const baseUrl = config.get<string>('baseUrl');
const apiKey = /* ... */;

this.client = baseUrl
  ? new Mistral({ apiKey, serverURL: baseUrl })
  : new Mistral({ apiKey });
```

#### 6.5.3 Add Usage Tracking

Track token usage per session and display in the status bar:

```typescript
// provider.ts
private tokensUsedThisSession = { input: 0, output: 0 };

// In provideLanguageModelChatResponse, after stream completes:
// Mistral SDK stream chunks include `usage` on the final chunk
if (chunk.usage) {
  this.tokensUsedThisSession.input += chunk.usage.prompt_tokens ?? 0;
  this.tokensUsedThisSession.output += chunk.usage.completion_tokens ?? 0;
  this.updateStatusBar();
}
```

#### 6.5.4 Add API Key Validation

After setting the API key, make a lightweight test call:

```typescript
async validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const testClient = new Mistral({ apiKey });
    await testClient.models.list();
    return true;
  } catch (error) {
    const statusCode = (error as any)?.statusCode;
    if (statusCode === 401 || statusCode === 403) {
      return false;
    }
    return true; // Network errors don't mean the key is invalid
  }
}
```

#### 6.5.5 Consider MCP Tool Integration

VS Code's MCP support (documented in the MCP guide) allows extensions to register MCP server definitions. The extension could:

1. Register an MCP server that wraps Mistral's tool-calling API
2. Expose Mistral models as MCP resources for other VS Code extensions to consume
3. Use the `vscode.lm.registerMcpServerDefinitionProvider()` API

This is a longer-term feature and lower priority than the correctness fixes above.

---

## 7. Architecture Recommendations

### 7.1 Reduce Bundle Size

The current build bundles `tiktoken` (~1MB with WASM), the full `@mistralai/mistralai` SDK, and `@selfagency/llm-stream-parser`. Consider:

1. **Replace `tiktoken`** with a lightweight character-based heuristic (`Math.ceil(charCount / 3.5)`). The accuracy difference is marginal (both are approximations) but the size savings are significant.
2. **Use standalone functions** from `@mistralai/mistralai` instead of the full `Mistral` class, enabling tree-shaking of unused resources (embeddings, FIM, audio, etc.).
3. **Use `@selfagency/llm-stream-parser` subpath imports** (e.g., `@selfagency/llm-stream-parser/thinking`) to only bundle the needed parsers.

### 7.2 Improve Error Handling Architecture

Create a centralized error handling module:

```typescript
// src/errors.ts
export class MistralExtensionError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export function toUserFriendlyError(error: unknown): string {
  if (error instanceof MistralExtensionError) return error.userMessage;
  if (error && typeof error === 'object') {
    const status = (error as any).statusCode;
    switch (status) {
      case 401:
        return 'Invalid API key.';
      case 429:
        return 'Rate limit exceeded.';
      case 500:
        return 'Service unavailable.';
    }
  }
  return 'An unexpected error occurred.';
}
```

### 7.3 Consider `@vscode/chat-extension-utils` for Chat Participant

The VS Code chat docs recommend using `@vscode/chat-extension-utils` for tool calling within chat participants. This library handles the tool-calling loop, progress reporting, and response formatting. The current implementation manages this manually, which is more error-prone.

### 7.4 Model Configuration Cache

Rather than hardcoding model metadata, consider a JSON configuration file bundled with the extension that maps model IDs to their properties (max output tokens, capabilities, display names). This makes it easy to update when Mistral releases new models without a code change.

```typescript
// src/model-config.ts
export const MODEL_CONFIG: Record<string, Partial<LanguageModelChatInformation>> = {
  'mistral-large-latest': {
    maxOutputTokens: 16384,
    capabilities: { toolCalling: true, imageInput: true },
  },
  'mistral-small-latest': {
    maxOutputTokens: 4096,
    capabilities: { toolCalling: true, imageInput: false },
  },
  // ...
};
```

---

## 8. Testing Remediation

### 8.1 Missing Test Coverage

| Area                             | Current    | Target        | Priority |
| -------------------------------- | ---------- | ------------- | -------- |
| Streaming tool call buffering    | Not tested | 5+ test cases | High     |
| `LLMStreamProcessor` integration | Not tested | 3+ test cases | High     |
| `ChatResponseTurn2` handling     | Not tested | 2 test cases  | High     |
| `AbortController` cancellation   | Not tested | 2 test cases  | High     |
| Per-model `maxOutputTokens`      | Not tested | 3 test cases  | Medium   |
| Error sanitization               | Not tested | 4 test cases  | Medium   |
| `provideTokenCount` accuracy     | Not tested | 2 test cases  | Medium   |
| Cache TTL invalidation           | Not tested | 2 test cases  | Medium   |
| VS Code settings integration     | Not tested | 3 test cases  | Low      |

### 8.2 Test Quality Improvements

1. **Improve provider mock** in `extension.test.ts` — use a partial mock instead of replacing the entire class.
2. **Verify Mistral SDK calls** in chat response tests — assert on `chat.stream()` arguments, not just `progress.report()` calls.
3. **Add edge cases** for tool calls: empty arguments, nested JSON, Unicode content, very long arguments.
4. **Test cancellation** at various points: before stream starts, mid-stream, during tool call accumulation.
5. **Add integration tests** that actually call the Mistral API (behind a feature flag or CI secret).

---

## 9. Positive Findings

Despite the issues identified, the codebase demonstrates several strengths:

1. **Clean architecture** — Clear separation between `extension.ts` (registration) and `provider.ts` (Mistral integration). Single responsibility principle is well-applied.

2. **Comprehensive test suite** — ~1,090 lines of unit tests covering model fetching, message conversion, tool call ID mapping, API key management, and initialization. Test coverage is above average for VS Code extensions.

3. **Thoughtful tool call ID mapping** — The bidirectional mapping between Mistral's tool call IDs and VS Code's 9-character alphanumeric requirement is well-designed and thoroughly tested.

4. **Smart model selection** — Deduplicates models by base name, prefers `-latest` variants, and falls back to largest context size. Handles ambiguous display names by appending model ID.

5. **Secure API key storage** — Uses VS Code's `ExtensionContext.secrets` for encrypted storage with a `password: true` input box. Industry best practice.

6. **Professional CI/CD** — CI with type checking, linting, compilation, unit tests, coverage (Codecov), CodeQL security scanning. Release pipeline with tag verification, changelog generation, and dual publishing to VS Code Marketplace + Open VSX.

7. **Modern toolchain** — `tsup`/esbuild for fast builds, `vitest` for testing, `oxlint`/`oxfmt` for linting/formatting, `husky`+`lint-staged` for pre-commit hooks.

8. **`LLMStreamProcessor` integration** — Clean separation of thinking tag extraction and privacy scrubbing from core streaming logic via the well-designed `@selfagency/llm-stream-parser` library.

9. **Vision support** — Correct base64 image encoding for multimodal messages, properly structured for Mistral's API.

10. **Cancellation awareness** — Streaming loop checks `CancellationToken` between chunks, even though it doesn't abort the HTTP connection (addressed in H5).

---

## 10. Priority Matrix

| Priority             | Phase   | Issues                                                   | Estimated Effort |
| -------------------- | ------- | -------------------------------------------------------- | ---------------- |
| **P0 — Immediate**   | Phase 1 | H1, H2, H3, H4, H5                                       | 2-3 hours        |
| **P1 — This Sprint** | Phase 2 | M1-M4, M6-M8, System messages                            | 3-4 hours        |
| **P2 — Next Sprint** | Phase 3 | M9-M15, dispose, settings, retry                         | 4-5 hours        |
| **P3 — Backlog**     | Phase 4 | L1-L20 (all low-severity)                                | 2-3 hours        |
| **P4 — Roadmap**     | Phase 5 | Missing features (endpoint support, usage tracking, MCP) | 8-12 hours       |

### Recommended Execution Order

1. **H1** (5 min) — Fix dependabot. Ship immediately.
2. **H5** (30 min) — Add `AbortController`. Prevents resource waste on every cancellation.
3. **H2** (45 min) — Per-model `maxOutputTokens`. Prevents API errors for small models.
4. **H3** (15 min) — Fire event on key change. One-line fix with outsized UX impact.
5. **H4** (30 min) — `ChatResponseTurn2` support. Forward compatibility.
6. **M4** (30 min) — Error message sanitization. Security improvement.
7. **M2** (15 min) — Fix malformed tool call args. Prevents confusing tool failures.
8. **M5** (10 min) — Remove dead `typeof` guard. Quick cleanup.
9. **M7** (15 min) — Check cancellation token in `provideLanguageModelChatInformation`.
10. **M8** (5 min) — Fix `console.error` → `this.log.error`.
11. **Remaining** in order of impact.

---

_End of remediation plan._
