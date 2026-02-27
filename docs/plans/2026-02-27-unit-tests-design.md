# Unit Tests Design

**Date:** 2026-02-27
**Scope:** Expose internal functions in `provider.ts` and `extension.ts`, then add vitest unit tests.

## Approach

Option A: export standalone module-level functions, make private class methods public. Minimal structural change, maximum coverage.

## Changes to `provider.ts`

### Export standalone functions

Add `export` to:
- `formatModelName(id: string): string`
- `getChatModelInfo(model: MistralModel): LanguageModelChatInformation`
- `toMistralRole(role: LanguageModelChatMessageRole): 'user' | 'assistant'`

Also export: `MistralModel` interface, `MistralMessage` type.

### Make class methods public

Change `private` → `public` on:
- `generateToolCallId()`
- `getOrCreateVsCodeToolCallId(mistralId)`
- `getMistralToolCallId(vsCodeId)`
- `clearToolCallIdMappings()`
- `toMistralMessages(messages)`
- `fetchModels()`

`initClient` stays private (touches VS Code window/secrets). `setApiKey` is already public.

## VS Code Mock

**`src/test/vscode.mock.ts`** — shared stub module used by `vi.mock('vscode', ...)`.

Implements the classes used in `instanceof` checks:
- `LanguageModelTextPart` — `{ value: string }`
- `LanguageModelToolCallPart` — `{ callId, name, input }`
- `LanguageModelToolResultPart` — `{ callId, content[] }`
- `LanguageModelDataPart` — `{ mimeType, data }`
- Enums: `LanguageModelChatMessageRole`, `LanguageModelChatToolMode`, `InputBoxValidationSeverity`
- Stubs: `window` (with `showInputBox`)

## Test Files

### `src/provider.test.ts`

| Group | Cases |
|---|---|
| `formatModelName` | single segment, multi-segment, handles numbers in segment |
| `getChatModelInfo` | with detail (tooltip includes detail), without detail, capabilities flags |
| `toMistralRole` | User → `'user'`, Assistant → `'assistant'`, unknown value → `'user'` |
| `generateToolCallId` | length is 9, alphanumeric only, two calls produce different IDs |
| `getOrCreateVsCodeToolCallId` | same Mistral ID returns same VS Code ID, creates bidirectional mapping |
| `getMistralToolCallId` | returns mapped Mistral ID, returns undefined for unknown VS Code ID |
| `clearToolCallIdMappings` | both maps empty after clear |
| `fetchModels` | returns empty when no client, returns filtered+mapped models from API, caches result (second call skips API), handles API error gracefully |
| `toMistralMessages` | plain text user message, assistant text message, assistant with tool calls, tool result → `role:"tool"` message, image data encoded as base64 imageUrl, non-image data part stringified as text, empty assistant message skipped, mixed text+tool call in one VS Code message |

### `src/extension.test.ts`

- `activate` registers exactly 2 subscriptions (provider + command)
- `deactivate` returns undefined

## Vitest Config

**`vitest.config.ts`** at project root:
- `environment: 'node'`
- No global setup file needed — each test file uses `vi.mock('vscode', () => import('./test/vscode.mock'))` directly

## File Summary

| File | Action |
|---|---|
| `src/provider.ts` | Add `export` to 3 fns, change 6 methods from `private` to `public`, export 2 types |
| `src/test/vscode.mock.ts` | Create — shared VS Code stub classes |
| `src/provider.test.ts` | Create — ~50 test cases |
| `src/extension.test.ts` | Create — 2 test cases |
| `vitest.config.ts` | Create — node environment config |
