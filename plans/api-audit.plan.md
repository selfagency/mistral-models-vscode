# API Compatibility Audit & Remediation Plan

**Audit Date:** 2025-07-15 · **Updated:** 2026-05-03  
**VS Code target:** `@types/vscode@1.109.0` / `engines.vscode: ^1.109.0`  
**Mistral SDK:** `@mistralai/mistralai@1.14.1`  
**llm-stream-parser:** `@selfagency/llm-stream-parser@0.3.1`  
**Sources:** `microsoft/vscode` (vscode.d.ts), `mistralai/client-ts`, `selfagency/llm-stream-parser`

---

## Status Legend

- ✅ **DONE** — implemented in the working tree
- 🔲 **TODO** — not yet implemented
- ⏭️ **DEFERRED** — intentionally deferred with rationale

---

## Audit Summary

The codebase is functional and all 128 tests pass. However, a cross-reference against upstream APIs
reveals type divergences, missing features, and unnecessary casts that create maintenance risk and
limit capability exposure.

A second audit pass was added on 2026-05-03 to map every useful export from
`@selfagency/llm-stream-parser@0.3.1` against the current integration — both what is already used
and what is missing.

---

## Findings

### 🔴 CRITICAL — Type Safety / API Correctness

#### F-1: `LanguageModelChatMessage` used instead of `LanguageModelChatRequestMessage` in provider interface

**Files:** `src/provider.ts`  
**Affected methods:** `provideLanguageModelChatResponse`, `toMistralMessages`, `provideTokenCount`

The `LanguageModelChatProvider` interface requires:
```typescript
provideLanguageModelChatResponse(
  model: T,
  messages: readonly LanguageModelChatRequestMessage[],
  ...
): Thenable<void>

provideTokenCount(
  model: T,
  text: string | LanguageModelChatRequestMessage,
  token: CancellationToken,
): Thenable<number>
```

Our implementation declares `Array<LanguageModelChatMessage>` (the concrete class) instead of
`LanguageModelChatRequestMessage` (the interface that providers receive). TypeScript accepts this
due to structural compatibility, but this is semantically wrong: VS Code passes
`LanguageModelChatRequestMessage` objects which are **not** guaranteed to be `LanguageModelChatMessage`
class instances. Downstream `instanceof LanguageModelTextPart` guards will fail silently if VS Code
ever passes a different concrete type.

**Fix:** Update method signatures to use `LanguageModelChatRequestMessage` and update `toMistralMessages`
to accept `readonly LanguageModelChatRequestMessage[]`. The VS Code `LanguageModelInputPart` type
replaces `LanguageModelTextPart | LanguageModelToolCallPart | ...` for part iteration.

---

#### F-2: Custom `MistralMessage` type diverges from SDK message types

**File:** `src/provider.ts` (lines ~88–96, `toMistralMessages`)

We define our own `MistralMessage`, `MistralContent`, `MistralToolCall` types rather than importing
from the SDK. The SDK exports `UserMessage`, `AssistantMessage`, `SystemMessage`, `ToolMessage`, and
`ToolCall` types from `@mistralai/mistralai`. Our custom types are partially aligned but have gaps:

| Field | SDK (`ToolCall`) | Ours (`MistralToolCall`) |
|---|---|---|
| `id` | `string \| undefined` | `string` ✓ |
| `type` | `ToolTypes \| undefined` | `'function'` ✓ |
| `function` | `FunctionCall` | `{ name, arguments }` ✓ |
| `index` | `number \| undefined` | **missing** ❌ |

The `index` field in `ToolCall` is used to order tool calls during streaming when
`parallelToolCalls: true`. Without it, the SDK defaults it to `0` for all tool calls during Zod
outbound serialization, which could corrupt parallel call ordering.

The SDK also has `AssistantMessage.prefix: boolean` (forces the model to start its response with the
provided content), which our type omits entirely.

**Fix:** Either import and use SDK types directly, or add `index?: number` to `MistralToolCall` and
`prefix?: boolean` to the assistant message variant. Using SDK types is preferred.

---

#### ✅ F-3: `logOutputChannel as any` cast in `extension.ts` — DONE

**File:** `src/extension.ts` (line 10)

```typescript
const logOutputChannel =
  typeof vscode.window.createOutputChannel === 'function'
    ? vscode.window.createOutputChannel('Mistral Models', { log: true })
    : undefined;
const provider = new MistralChatModelProvider(context, logOutputChannel as any, true);
```

The `typeof` guard causes TypeScript to infer the return type as `vscode.OutputChannel` (the
overload without `{ log: true }` option). This forces the `as any` cast. The guard is vestigial
— `createOutputChannel` has been stable since VS Code 1.0 and is always a function in our minimum
target 1.109.

**Fix:** Remove the `typeof` guard. Use a type-safe cast:
```typescript
const logOutputChannel = vscode.window.createOutputChannel(
  'Mistral Models',
  { log: true },
) as vscode.LogOutputChannel;
```

---

#### F-4: `(vscode.Uri as any).joinPath` cast in `extension.ts` — PARTIAL

**File:** `src/extension.ts` (last line of `activate`)

> ⚠️ Removing the cast exposes `TS2339: Property 'joinPath' does not exist on type 'typeof Uri'` even
> though it IS typed in `@types/vscode@1.109.0`. This appears to be a module resolution quirk with
> `module: Node16` and the vscode mock in tests. The cast must stay until the root cause is resolved.
> Leave as `(vscode.Uri as any).joinPath` for now.

**Original finding:**

```typescript
participant.iconPath = (vscode.Uri as any).joinPath(context.extensionUri, 'logo.png');
```

`vscode.Uri.joinPath` has been a stable static method since VS Code 1.45 and is typed in
`@types/vscode@1.109.0`. No cast is needed.

**Fix:** Remove the cast:
```typescript
participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'logo.png');
```

---

### 🟡 IMPORTANT — Missing Features / Capability Gaps

#### F-5: Missing `modelOptions` forwarding to Mistral SDK

**File:** `src/provider.ts` (`provideLanguageModelChatResponse`)

We forward `temperature`, `topP`, and `safePrompt` from `options.modelOptions` but omit several
parameters the SDK supports:

| Parameter | Mistral SDK field | Notes |
|---|---|---|
| `responseFormat` | `responseFormat` | Structured JSON output (`json_object` / `json_schema`) |
| `randomSeed` | `randomSeed` | Deterministic results across calls |
| `stop` | `stop` | Stop sequences (`string \| string[]`) |
| `presencePenalty` | `presencePenalty` | Penalize repeated tokens |
| `frequencyPenalty` | `frequencyPenalty` | Penalize high-frequency tokens |
| `promptMode` | `promptMode` | `'reasoning'` for Mistral reasoning models |

Extensions using `sendRequest` can pass these via `modelOptions` today, but they are silently
discarded instead of being forwarded to Mistral.

**Fix:** Add forwarding for each parameter with appropriate type guards:
```typescript
const responseFormat =
  modelOptions.responseFormat && typeof modelOptions.responseFormat === 'object'
    ? (modelOptions.responseFormat as { type: string })
    : undefined;
const randomSeed = typeof modelOptions.randomSeed === 'number' ? modelOptions.randomSeed : undefined;
const stop = Array.isArray(modelOptions.stop)
  ? (modelOptions.stop as string[])
  : typeof modelOptions.stop === 'string'
    ? modelOptions.stop
    : undefined;
const presencePenalty =
  typeof modelOptions.presencePenalty === 'number' ? modelOptions.presencePenalty : undefined;
const frequencyPenalty =
  typeof modelOptions.frequencyPenalty === 'number' ? modelOptions.frequencyPenalty : undefined;
const promptMode =
  modelOptions.promptMode === 'reasoning' ? 'reasoning' : undefined;
```

Pass them all to `this.client.chat.stream({...})`.

---

#### ✅ F-6: Reasoning model thinking content not handled — DONE (Phase A)

**File:** `src/provider.ts` (`provideLanguageModelChatResponse`)

Mistral reasoning models (e.g. `magistral-*`) emit thinking/reasoning tokens before the final
response. These were previously discarded.

**Resolved:** `normalizeMistralChunk` in `@selfagency/llm-stream-parser/normalizers` natively
extracts thinking from `magistral-*` structured content arrays (and any model using `<think>` tags).
The `LLMStreamProcessor` yields `OutputPart {type:'thinking'}` parts. The `_emitParts` helper in
`provider.ts` now logs thinking at `debug` level.

**Phase B (pending):** Report via `progress.report(new LanguageModelThinkingPart(...))` once the
proposed API is promoted to stable in `@types/vscode`.

---

#### F-7: `LanguageModelChatInformation.version` hardcoded to `'1.0.0'`

**File:** `src/provider.ts` (`getChatModelInfo`)

```typescript
version: '1.0.0',
```

The `version` field is used as a lookup key in `LanguageModelChatSelector.version`. Using a static
value means all Mistral models appear to be version `1.0.0`, making version-based model selection
impossible. The Mistral model list API returns model IDs that include version info (e.g.
`mistral-large-2411`). We should use the model ID as the version string, which is stable and unique.

**Fix:**
```typescript
version: model.id,
```

---

#### F-8: `DEFAULT_MAX_OUTPUT_TOKENS = 16384` cap too conservative

**File:** `src/provider.ts`

The hardcoded cap `DEFAULT_MAX_OUTPUT_TOKENS = 16384` is applied when the Mistral API doesn't return
an explicit output token limit. Several current Mistral models (e.g. `codestral-2501`) support up to
32768 or more output tokens. Capping at 16384 limits what Copilot Chat can request, potentially
truncating long code generation tasks.

**Fix:** Increase the default to `32768` or determine it dynamically from model ID patterns. Also
consider using `m.maxContextLength * 0.5` as a heuristic for models that don't specify an explicit
output limit (models rarely use more than half their context for output).

---

### 🟢 SUGGESTIONS — Code Quality / Future-Proofing

#### ✅ F-9: `@selfagency/llm-stream-parser` now fully integrated — RESOLVED

**File:** `package.json`, `src/provider.ts`

Previously flagged as an unused dependency. As of 2026-05-03 the library is actively used:

- `normalizeMistralChunk` from `./normalizers` — normalizes every raw SDK event
- `LLMStreamProcessor` + `OutputPart` from `./processor` — processes normalized chunks
- `cancellationTokenToAbortSignal` from `./renderers/vscode` — converts VS Code `CancellationToken`
  to `AbortSignal` for the Mistral SDK `RequestOptions.signal`

The dependency is now load-bearing. Do not remove. See Section 2 below for remaining gaps.

---

#### F-10: `toMistralRole` does not handle future System role

**File:** `src/provider.ts`

The current VS Code 1.109 public API only exposes `User = 1` and `Assistant = 2` in
`LanguageModelChatMessageRole`. However, VS Code internally has a `System` role used in proposed
APIs. Our fallthrough `default: return 'user'` silently maps any unrecognized role to user, which is
wrong for system messages.

**Fix:** Add explicit handling and a warning log:
```typescript
export function toMistralRole(role: LanguageModelChatMessageRole): 'user' | 'assistant' | 'system' {
  switch (role) {
    case LanguageModelChatMessageRole.User:
      return 'user';
    case LanguageModelChatMessageRole.Assistant:
      return 'assistant';
    default:
      // VS Code may add System (3) in future API versions.
      // Numeric value 3 = System based on internal vscode source.
      if ((role as number) === 3) return 'system';
      return 'user';
  }
}
```

Update `MistralMessage` type to include `{ role: 'system'; content: string }` variant and handle
it in `toMistralMessages`.

---

#### F-11: `LanguageModelChatCapabilities.toolCalling` could convey tool limit

**File:** `src/provider.ts` (`getChatModelInfo`)

The VS Code type is `toolCalling?: boolean | number`. When a number is provided, it specifies the
maximum number of tools the model accepts per request. Some Mistral models have effective tool limits.
Using `true` is correct but less informative than a specific number when limits are known.

**Fix:** For now, keep as `boolean`. Add a `TODO` comment to surface this when Mistral API exposes
per-model tool limits in `capabilities`.

---

#### F-12: Mistral SDK v2 migration path needs documentation

The `@mistralai/mistralai` v2.0 SDK is ESM-only, which conflicts with our CJS build via tsup.
A future upgrade would require either:
- Switching to ESM output (`format: ['esm']` in tsup.config.mjs and adding `"type": "module"` to
  package.json), or
- Using dynamic `import()` at runtime to load the ESM package from a CJS context.

Since VS Code extensions use CJS today and the v1.14.x branch still receives fixes, this is not
urgent. Document this in the upgrade plan for future reference.

---

## Implementation Plan

### Phase 1 — Type Safety Fixes (Breaking-free, test-covered)

**Effort:** ~2 hours  
**Risk:** Low

1. `F-3`: Remove `typeof` guard and fix `logOutputChannel` cast in `extension.ts`
2. `F-4`: Remove `(vscode.Uri as any)` cast in `extension.ts`
3. `F-1`: Update `provideLanguageModelChatResponse`, `toMistralMessages`, `provideTokenCount`
   to use `LanguageModelChatRequestMessage` and `LanguageModelInputPart`
4. `F-2`: Add `index?: number` to `MistralToolCall`, add `prefix?: boolean` to assistant
   message variant
5. `F-7`: Change `version: '1.0.0'` → `version: model.id` in `getChatModelInfo`

**Test changes:** Update `provider.test.ts` mock types; update `getChatModelInfo` version assertions.

---

### Phase 2 — Missing `modelOptions` Passthrough (Feature, tested)

**Effort:** ~1.5 hours  
**Risk:** Low–Medium (new parameters forwarded to Mistral; no behavior change for existing callers)

1. `F-5`: Add forwarding for `responseFormat`, `randomSeed`, `stop`, `presencePenalty`,
   `frequencyPenalty`, `promptMode` in `provideLanguageModelChatResponse`
2. Add unit tests covering each new parameter being forwarded

---

### Phase 3 — llm-stream-parser Callback Wiring (Feature, low-risk)

**Status:** 🔲 Not started  
**Effort:** ~1 hour  
**Risk:** Very low (additive only — logging and optional UI progress)

Wire the three missing `ProcessorOptions` callbacks in `provider.ts`:

1. `F-13`: `onFinish` — log finish reason and usage at `info` level
2. `F-14`: `onStep` — log step index transitions at `info` level
3. `F-15`: `onToolCallDelta` — log at `debug` level

---

### Phase 4 — Default Token Cap & Code Quality

**Effort:** ~30 minutes  
**Risk:** Very low

1. `F-8`: Increase `DEFAULT_MAX_OUTPUT_TOKENS` from `16384` to `32768`
2. `F-10`: Add system-role guard to `toMistralRole` with warning log
3. `F-11`: Add TODO comment on `toolCalling` numeric capability

---

### Phase 5 — Agent Loop Renderer (Participant Direct Streaming)

**Status:** 🔲 Requires architectural decision  
**Effort:** ~3–4 hours  
**Risk:** Medium (changes participant architecture; replaces `request.model.sendRequest()`)

This is the highest-value remaining feature from the library. Currently the participant delegates
to the VS Code LM API which calls back into our `LanguageModelChatProvider`. A direct Mistral
streaming path in the participant would:

- Remove the round-trip through VS Code's internal LM routing
- Enable `createVSCodeAgentLoop` with full `onToolCall`, `onStep`, `onFinish`, and proposed API
  hooks (`thinkingProgress`, `beginToolInvocation`, `usage`)
- Make thinking blocks visible in the chat UI via `stream.progress()` or `thinkingProgress()`
- Surface per-step progress during multi-turn tool use

**Prerequisite:** Tool execution capability in the participant (requires implementing a local tool
runner or accepting tools from `request.tools`).

See F-16 for the implementation sketch.

---

## Files to Change

| File | Phases |
|---|---|
| `src/extension.ts` | 1, 5 |
| `src/provider.ts` | 1, 2, 3, 4 |
| `src/provider.test.ts` | 1, 2, 3 |
| `src/extension.test.ts` | 1 (version assertion) |
| `package.json` | (no longer removing dep — F-9 resolved) |

---

## Section 2 — `@selfagency/llm-stream-parser@0.3.1` Feature Gap Audit

This section maps every public export of the library against the current integration and identifies
what is used, what is missing, and what to implement next.

### 2.1 — What Is Currently Integrated ✅

| Export | Subpath | Used in |
|---|---|---|
| `normalizeMistralChunk` | `./normalizers` | `provider.ts` streaming loop |
| `LLMStreamProcessor` | `./processor` | `provider.ts` — drives `_emitParts` |
| `OutputPart` (type) | `./processor` | `_emitParts` parameter |
| `cancellationTokenToAbortSignal` | `./renderers/vscode` | `provider.ts` — abort signal wired to SDK |

The processor is configured with `accumulateNativeToolCalls: true` and `modelId`. The `_emitParts`
helper handles `text`, `thinking` (log only), and `tool_call` parts. `tool_call_delta` parts are
intentionally skipped since native accumulation is on.

---

### 2.2 — `BaseRendererOptions` Callbacks — All Missing 🔲

`BaseRendererOptions` (inherited by both `VSCodeChatRendererOptions` and `VSCodeAgentLoopOptions`)
exposes five callbacks that the current integration ignores. These should be wired directly into
`ProcessorOptions` in `provider.ts` since we use `LLMStreamProcessor` manually rather than through
a renderer.

#### F-13: `onFinish` callback not wired 🔲

**Applicable to:** `ProcessorOptions.onFinish` — called when the stream finishes with
`(finishReason: FinishReason | undefined, usage: UsageInfo | undefined) => void`.

The processor does not currently surface finish reason or token usage back to the extension.
Usage info is particularly valuable: it could be logged at `info` level and later forwarded to
VS Code's proposed `ChatResponseStream.usage()` API (already typed in the library's
`ChatResponseStream` interface).

**Fix:**

```typescript
const processor = new LLMStreamProcessor({
  modelId: model.id,
  accumulateNativeToolCalls: true,
  onWarning: (msg, ctx) => this.log.warn('[Mistral] ' + msg + (ctx ? ' ' + JSON.stringify(ctx) : '')),
  onFinish: (finishReason, usage) => {
    if (finishReason) this.log.info(`[Mistral] stream finished: ${finishReason}`);
    if (usage) this.log.info(`[Mistral] usage: prompt=${usage.promptTokens} completion=${usage.completionTokens}`);
  },
});
```

---

#### F-14: `onStep` callback not wired — agent loop step tracking missing 🔲

**Applicable to:** `ProcessorOptions.onStep` — fired when `StreamChunk.stepIndex` increments
between tool call boundaries in a multi-step agent loop.

**Why it matters:** Step transitions are currently invisible — no per-step logging or progress
indicator.

**Fix for `provider.ts`:**

```typescript
onStep: (stepIndex, usage) => {
  this.log.info(`[Mistral] agent step ${stepIndex}` + (usage ? ` (tokens so far: ${usage.completionTokens})` : ''));
},
```

**Long-term:** Pair with the agent loop renderer (see F-16) to surface step progress in the
chat UI via `stream.progress()`.

---

#### F-15: `onToolCallDelta` callback not wired — streaming arguments invisible 🔲

**Applicable to:** `ProcessorOptions.onToolCallDelta` — fired for each `tool_call_delta` part
while native tool call arguments are assembling (even when `accumulateNativeToolCalls: true`).

**Fix:** Add debug logging at minimum:

```typescript
onToolCallDelta: (delta) => {
  this.log.debug(`[Mistral] tool_call_delta: ${delta.name}[${delta.index}] +${delta.argumentsDelta.length}chars`);
},
```

---

### 2.3 — `createVSCodeAgentLoop` — VS Code Participant Integration 🔲

**Subpath:** `./renderers/vscode`  
**Export:** `createVSCodeAgentLoop(options: VSCodeAgentLoopOptions): RendererHandle`

**`VSCodeAgentLoopOptions`** (extends `BaseRendererOptions`):

| Option | Type | Notes |
|---|---|---|
| `stream` | `ChatResponseStream` | Required. VS Code `ChatResponseStream` instance. |
| `thinkingStyle` | `'blockquote' \| 'progress' \| 'suppress'` | Default `'blockquote'`. |
| `abortSignal` | `AbortSignal` | Optional external cancellation. |
| `showThinking` | `boolean` | Default `true` (differs from basic renderer). |
| `processor` | `LLMStreamProcessor` | Optional; renderer creates one internally if absent. |
| `onToolCall` | `(part: ToolCallPart) => void \| Promise<void>` | Called for each complete tool call. |
| `onToolCallDelta` | `(delta) => void` | Called for each native argument delta. |
| `onFinish` | `(reason, usage) => void \| Promise<void>` | Called on stream end. |
| `onStep` | `(stepIndex, usage) => void \| Promise<void>` | Called at each agent step boundary. |
| `onError` | `(error: Error) => void` | Called on render error. |

**`RendererHandle`** returned:

| Method | Signature | Notes |
|---|---|---|
| `write(chunk)` | `(chunk: string) => Promise<void>` | Process a raw text delta. |
| `writeChunk(chunk)` | `(chunk: StreamChunk) => Promise<void>` | Process a pre-normalized StreamChunk directly — preferred. |
| `end()` | `() => Promise<void>` | Flush buffers and finalize. |

#### F-16: `createVSCodeAgentLoop` not used in `extension.ts` participant handler 🔲

**File:** `src/extension.ts` — `participant.requestHandler`

Currently the participant calls `request.model.sendRequest()` which returns processed
`LanguageModelTextPart` objects. The renderer is not applicable here because the parts arrive
already processed. However, for a **direct Mistral streaming path** in the participant (bypassing
`sendRequest()`), `createVSCodeAgentLoop` is the correct renderer.

**Direct Mistral agent loop in participant — implementation sketch:**

```typescript
import {
  createVSCodeAgentLoop,
  cancellationTokenToAbortSignal,
} from '@selfagency/llm-stream-parser/renderers/vscode';
import { normalizeMistralChunk } from '@selfagency/llm-stream-parser/normalizers';

// Inside participant requestHandler:
const abortSignal = cancellationTokenToAbortSignal(token);
const renderer = createVSCodeAgentLoop({
  stream,                        // vscode.ChatResponseStream
  showThinking: true,
  thinkingStyle: 'progress',
  abortSignal,
  onToolCall: (part) => {
    // execute tool and feed result back into the Mistral client
  },
  onStep: (stepIndex, usage) => {
    stream.progress(`Step ${stepIndex + 1}…`);
  },
  onFinish: (reason, usage) => {
    // log final usage
  },
});

for await (const event of mistralStream) {
  if (token.isCancellationRequested) break;
  const normalized = normalizeMistralChunk(event.data);
  if (normalized) await renderer.writeChunk(normalized.chunk);
}
await renderer.end();
```

**Prerequisite:** Tool execution capability in the participant.

---

### 2.4 — `createVSCodeChatRenderer` — Single-turn Chat 🔲

**Subpath:** `./renderers/vscode`

Lighter-weight variant of the agent loop renderer without `onStep` or `abortSignal`.
Appropriate for simple single-turn responses where no tool calls or multi-step loops are expected.

**Assessment:** `createVSCodeAgentLoop` is a strict superset. Prefer the agent loop renderer when
migrating the participant to avoid maintaining two code paths.

---

### 2.5 — Pipeline Transforms — Token Smoothing & Filtering 🔲

**Subpath:** `./pipeline`

| Export | Purpose |
|---|---|
| `createPipeline` | Raw SSE → `PipelineEvent` generator (not applicable — we use the SDK). |
| `createSmoothStream` | `TransformStream<OutputPart, OutputPart>` — chunks large text deltas. |
| `createThinkingFilter` | `TransformStream<OutputPart, OutputPart>` — strips all thinking parts. |
| `createToolCallFilter` | `TransformStream<OutputPart, OutputPart>` — filters named tool calls. |

#### F-17: `createSmoothStream` not applied — bursty token delivery 🔲

`magistral-*` reasoning models emit very large text deltas as single events, causing the VS Code
chat panel to render in visible jumps.

**Immediate workaround** (without migrating to `ReadableStream` pipelines):

```typescript
// In _emitParts, replace the simple text report with chunked emission:
if (part.type === 'text') {
  const CHUNK_SIZE = 40;
  if (part.text.length <= CHUNK_SIZE) {
    progress.report(new LanguageModelTextPart(part.text));
  } else {
    for (let i = 0; i < part.text.length; i += CHUNK_SIZE) {
      progress.report(new LanguageModelTextPart(part.text.slice(i, i + CHUNK_SIZE)));
    }
  }
}
```

**Full fix** (when migrating to `ReadableStream` pipeline): pipe output through
`createSmoothStream({ chunkSize: 40 })` before dispatch.

**Assessment:** Low priority for `LanguageModelChatProvider` (VS Code tolerates bursty delivery);
higher value for the chat participant's `ChatResponseStream` where markdown flicker is visible.

---

### 2.6 — `createPipeline` — Not Applicable

`createPipeline` processes raw SSE strings from an `AsyncIterable<string>`. We use the
`@mistralai/mistralai` SDK which delivers typed event objects. The `normalizeMistralChunk` +
`LLMStreamProcessor` path is the correct equivalent. Skip.

---

### 2.7 — Proposed VS Code API Surface — Capability Guards Needed 🔲

The library's `ChatResponseStream` interface types optional proposed API methods. Not yet stable
in `@types/vscode@1.109.0` but present in VS Code Insiders.

| Method | Purpose |
|---|---|
| `thinkingProgress(delta)` | Stream thinking tokens incrementally to the UI |
| `beginToolInvocation(id, name, data?)` | Open a tool invocation UI block |
| `updateToolInvocation(id, data)` | Update streaming tool invocation state |
| `usage(usage)` | Report final token usage counts to the chat UI |

#### F-18: No capability guards before proposed API calls 🔲

When the participant gains a direct Mistral stream, guard each proposed method:

```typescript
if (stream.thinkingProgress && part.type === 'thinking') {
  stream.thinkingProgress({ text: part.text });
} else if (part.type === 'thinking') {
  stream.progress(`> ${part.text}`);  // stable API fallback
}

if (stream.beginToolInvocation && part.type === 'tool_call') {
  stream.beginToolInvocation(part.call.id ?? callId, part.call.name);
}
```

`createVSCodeAgentLoop` performs these guards internally — another reason to prefer it.

---

## Non-Issues Confirmed

- **Vision `imageUrl` format**: `ImageURLChunk.imageUrl` accepts `string | ImageURL`. Our
  `data:mime/type;base64,...` string is valid. ✓
- **`toolChoice: 'any'`** for `LanguageModelChatToolMode.Required`: Correct mapping. ✓
- **`LanguageModelChatCapabilities` fields**: Only `toolCalling` and `imageInput` are stable in
  1.109. Our implementation is complete for the stable API. ✓
- **`ProvideLanguageModelChatResponseOptions` shape**: `modelOptions`, `tools`, `toolMode` all
  present in `@types/vscode@1.109.0`. ✓
- **`LanguageModelChatMessageRole` enum**: Only `User = 1` and `Assistant = 2` in public 1.109. ✓
- **Tool call buffering**: Replaced by `LLMStreamProcessor` with `accumulateNativeToolCalls: true`. ✓
- **Model deduplication and 'latest' preference logic**: Sound approach. ✓
- **`isCacheExpired()` and 30-minute TTL**: Correct implementation. ✓
