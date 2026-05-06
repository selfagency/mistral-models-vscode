# Agentsy Package Adoption Plan

## Executive Summary

The Mistral VS Code extension is currently using **3 of 17 published Agentsy packages** but only a subset of the exports available in those 3 packages. This document tracks the full adoption opportunity across all 17 published packages and all relevant exports.

**Current Status (as of May 2026 audit against agentsy@main):**

- ✅ Core renderer + stream orchestration: Adopted but incomplete (`@agentsy/vscode` has ~10 unused exports)
- ⚠️ Message conversion: Manual implementation — `toMistralMessages()` from `@agentsy/adapters` is a direct drop-in
- ⚠️ Tool call accumulation: Manual — `ToolCallDeltaAccumulator`/`toVSCodeToolCallPart` in `@agentsy/vscode` are unused
- ⚠️ Stream pipeline helpers: Manual — `processRawStream()`/`createGenericAdapter()` in `@agentsy/adapters` unused
- ⚠️ Context management: Not used
- ⚠️ Recovery/resilience: Not used
- ⚠️ `@agentsy/xml-filter`: Package entirely missing from previous plan

---

## Agentsy Ecosystem Overview

> **Package catalog source:** <https://agentsy.self.agency/packages.html>
> **17 published packages** (+ 1 private `@agentsy/integration` test harness)

### Currently Adopted ✅

| Package                | Version | Role                                     | Imports Used                                                                                           | Unused Exports (High Value)                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agentsy/vscode`      | ^0.1.1  | VS Code integration, rendering, settings | `ApiKeyManager`, `createVSCodeChatRenderer`, `createVSCodeAgentLoop`, `cancellationTokenToAbortSignal` | `BaseLanguageModelChatProvider`, `ToolCallDeltaAccumulator`, `accumulateToolCallDeltas`, `toVSCodeToolCallPart`, `mapUsageToVSCode`, `UsageStatusBar`, `McpServerRegistry`, `createMcpServerDefinitionProvider`, `SettingsLoader`, test stubs (`createMockApiKeyManager`, `createMockRendererHandle`, `createChunkNormalizerStub`) |
| `@agentsy/normalizers` | ^0.1.2  | Response normalization                   | `normalizeMistralChunk`                                                                                | All other normalizers irrelevant (Anthropic, Bedrock, Cohere, DeepSeek, Gemini, HF-TGI, Ollama, OpenAI, Z.ai)                                                                                                                                                                                                                      |
| `@agentsy/processor`   | ^0.1.2  | Stream orchestration, event pipeline     | `LLMStreamProcessor`                                                                                   | `createZAiInlineToolCallParser` (not relevant); `ProcessorOptions`, `ProcessedOutput` types may be useful                                                                                                                                                                                                                          |

### High-Priority Adoption Candidates 🎯

| Package               | Role                                          | Why Relevant                                                                                                                                                                           | Effort | Benefit  |
| --------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| `@agentsy/adapters`   | Mistral message conversion + stream pipeline  | **`toMistralMessages()`** directly replaces our manual message construction + tool-call ID normalization; `processRawStream()` and `createGenericAdapter()` replace manual chunk loops | LOW    | CRITICAL |
| `@agentsy/tool-calls` | XML & native tool-call helpers                | Currently manually handling tool call ID mapping; could unify parsing; complements `ToolCallDeltaAccumulator`                                                                          | LOW    | HIGH     |
| `@agentsy/thinking`   | Incremental thinking extraction               | Support extended thinking models (future Mistral variants); extract `<think>` blocks                                                                                                   | MEDIUM | MEDIUM   |
| `@agentsy/structured` | JSON parsing, repair, validation              | Handle structured outputs, repair malformed JSON tool arguments                                                                                                                        | LOW    | MEDIUM   |
| `@agentsy/context`    | Context extraction, dedupe, normalization     | Optimize context window usage, dedup references                                                                                                                                        | MEDIUM | MEDIUM   |
| `@agentsy/recovery`   | Recovery snapshots, continuation prompts      | Resume interrupted conversations, save state                                                                                                                                           | HIGH   | HIGH     |
| `@agentsy/xml-filter` | XML tag filtering, privacy-oriented scrubbing | Strip internal XML reasoning tags before surface display; privacy scrubbing of sensitive content                                                                                       | LOW    | MEDIUM   |

### Medium-Priority Candidates 🟡

| Package               | Role                                  | Applicability                                                                             | Effort | Note                                                     |
| --------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| `@agentsy/agent`      | Multi-step agent loop                 | Already using simpler `createVSCodeAgentLoop`; relevant if multi-step coordination needed | MEDIUM | Consider for complex tool-call chains                    |
| `@agentsy/formatting` | Text sanitization, display formatting | Could improve rendering safety of tool results and LLM output                             | LOW    | Defensive measure; pairs well with `@agentsy/xml-filter` |
| `@agentsy/renderers`  | Plain-text rendering primitives       | Already using vscode renderer; this is the lower-level primitive                          | MEDIUM | Reference for understanding rendering patterns           |

### Low-Priority / Out-of-Scope 📋

| Package          | Reason                                                                |
| ---------------- | --------------------------------------------------------------------- |
| `@agentsy/sse`   | Server-sent-event parsing; we use direct streaming, not SSE           |
| `@agentsy/ui`    | Conversation state store; designed for AG-UI protocol, not VS Code    |
| `@agentsy/ag-ui` | AG-UI protocol bridge; not relevant for VS Code extension             |
| `@agentsy/types` | Shared type contracts; useful for reference but no direct integration |

---

## Remediation Plan & Progress Tracking

### Phase 1: Core Refactoring ✅ COMPLETE

**Objective:** Standardize on Agentsy renderers across all code paths

| Item                                           | Status  | Commit  | Details                                                |
| ---------------------------------------------- | ------- | ------- | ------------------------------------------------------ |
| 1.1 Consolidate cancellationTokenToAbortSignal | ✅ DONE | 388daf5 | Removed local duplicate, imported from @agentsy/vscode |
| 1.2 Integrate createVSCodeChatRenderer         | ✅ DONE | 388daf5 | Main chat handler now uses official renderer           |
| 1.3 Simplify createVSCodeAgentLoop             | ✅ DONE | 388daf5 | Removed unsupported callbacks                          |
| 1.4 Fix type narrowing in model iteration      | ✅ DONE | cc4656d | Improved type guards using `in` operator               |
| 1.5 Update build config for external deps      | ✅ DONE | 388daf5 | Mark @agentsy/\* packages as external in tsup          |

**Result:** Both chat and participant handlers use consistent Agentsy renderers. PR #18 ready for review.

---

### Phase 2a: Mistral Message Conversion via `@agentsy/adapters` 🔴 NEW - HIGH PRIORITY

**Objective:** Replace manual message construction with `toMistralMessages()` from `@agentsy/adapters`

**Current State:**

- Manual message construction in `src/provider.ts` (lines 560-610)
- Manual tool call ID normalization with `toolCallIdMapping` / `reverseToolCallIdMapping` (lines 268-346)
- The Mistral API requires tool call IDs matching `/^[A-Za-z0-9]{9}$/` — we implement this regex ourselves; `@agentsy/adapters` owns this contract

**What `@agentsy/adapters/mistral` provides:**

- `toMistralMessages(messages, options?)` — converts `MistralOutboundMessage[]` to `MistralMessage[]`, handling:
  - Tool call ID normalization (owns the `VALID_MISTRAL_TOOL_CALL_ID` regex)
  - Image part encoding to `data:` URIs
  - Tool result emission as separate `tool` role messages
  - `onWarning` hook for dropped/adjusted parts
- `MistralOutboundMessage` / `MistralOutboundPart` types
- `MistralOutboundAdapterOptions` with custom `normalizeToolCallId` override

**What `@agentsy/adapters/generic` provides (also relevant):**

- `processRawStream(source, normalize, options?)` — replaces our manual normalize+process loop
- `processStream(source, options?)` — for already-normalized streams
- `createGenericAdapter(callbacks, options?)` — callback-based adapter (onContent, onToolCall, onThinking, onDone, onError)
- `runStructuredDecisionFromRawStream(options)` — full normalize→process→schema-validate flow

**Proposed Changes:**

1. Add `@agentsy/adapters` to `package.json` dependencies
2. Replace manual message construction with `toMistralMessages()`
3. Remove `toolCallIdMapping` / `reverseToolCallIdMapping` maps — owned by adapter
4. Replace manual chunk loop with `processRawStream(mistralStream, normalizeMistralChunk)`

**Files to Modify:**

- `package.json` — add `@agentsy/adapters`
- `src/provider.ts` — lines 268-346 (ID mapping removal), lines 560-610 (message construction)

**Effort:** LOW-MEDIUM (~3 hours)
**Risk:** MEDIUM (changes message format pipeline; regression tests required)

**Status:** `PENDING - Blocked on Phase 1 validation`

---

### Phase 2b: Tool Call Accumulation via `@agentsy/vscode` 🟡 IN PROGRESS

**Objective:** Replace manual tool call delta handling with `ToolCallDeltaAccumulator` and `toVSCodeToolCallPart` already available in `@agentsy/vscode` (no new package needed)

**Current State:**

- Manual tool call ID mapping (toolCallIdMapping, reverseToolCallIdMapping)
- Manual tool call extraction from streaming
- Manual conversion to VS Code `LanguageModelToolCallPart` format

**What `@agentsy/vscode` already exports (unused):**

- `ToolCallDeltaAccumulator` — accumulates partial tool calls from streaming deltas
- `accumulateToolCallDeltas(accumulator, deltaPart)` — helper to feed deltas
- `toVSCodeToolCallPart(toolCallOutputPart)` — converts accumulated tool call to VS Code format
- `mapUsageToVSCode({ inputTokens, outputTokens })` — maps usage to `{ promptTokens, completionTokens }`

**Proposed Changes:**

1. Replace manual delta accumulation with `ToolCallDeltaAccumulator`
2. Replace manual VS Code format conversion with `toVSCodeToolCallPart()`
3. Replace manual usage mapping with `mapUsageToVSCode()`
4. If XML tool-call parsing is needed: import `extractXmlToolCalls()` from `@agentsy/tool-calls`

**Files to Modify:**

- `src/provider.ts` — lines 980-1020 (`_emitToolParts`), usage reporting section

**Effort:** LOW (~2 hours)
**Risk:** LOW (tool call flow is stable, existing tests validate behavior)

**Status:** `PENDING - Design phase`

---

### Phase 3: Extended Thinking Support 🟡 PENDING

**Objective:** Support extended thinking models (Claude, future Mistral variants)

**Requirements:**

- Extract thinking blocks separately from main content
- Display thinking in collapsible UI element (if VS Code API supports)
- Pass thinking context forward for reasoning transparency

**Proposed Integration:**

1. Import `@agentsy/thinking` for thinking block extraction
2. Connect thinking stream to separate render method
3. Update OutputPart type to handle thinking

**Files to Modify:**

- `src/provider.ts` - lines 26-31 (OutputPart type), lines 820-835 (processor event handlers)

**Effort:** MEDIUM (~4 hours)
**Risk:** MEDIUM (requires VS Code API exploration for UI display)
**Dependency:** Phase 1 ✅ Complete

**Status:** `BLOCKED - Awaiting extended thinking support in Mistral SDK`

---

### Phase 4: Structured Output Handling 🟡 PENDING

**Objective:** Validate and repair structured outputs (JSON, etc.)

**Use Cases:**

- Validate tool call parameter JSON before sending to tools
- Repair malformed JSON responses
- Handle streaming JSON accumulation

**Proposed Integration:**

1. Import `@agentsy/structured` - `parseJson()`, `repairJson()`
2. Add tool parameter validation layer in tool emission
3. Cache and report malformed outputs for debugging

**Files to Modify:**

- `src/provider.ts` - lines 995-1005 (tool call emission)
- New utility file: `src/validation.ts` - tool parameter validation

**Effort:** LOW (~2 hours)
**Risk:** LOW (defensive measure, opt-in validation)

**Status:** `BACKLOG - Lower priority; manual parsing currently sufficient`

---

### Phase 5: Context Optimization 🟡 PENDING

**Objective:** Dedup and optimize context window usage

**Requirements:**

- Track context window usage across conversation
- Deduplicate repeated references
- Optimize message packing

**Proposed Integration:**

1. Import `@agentsy/context` - dedup and normalization helpers
2. Add context analyzer to track window usage
3. Implement smart message filtering when approaching limits

**Files to Modify:**

- New file: `src/context-optimizer.ts` - context analysis
- `src/provider.ts` - lines 560-610 (message construction)

**Effort:** MEDIUM (~4-6 hours)
**Risk:** MEDIUM (changes message flow; needs careful validation)

**Status:** `BACKLOG - Defer until hitting context limit issues`

---

### Phase 6: Recovery & Session Management 🟡 PENDING

**Objective:** Support conversation recovery and persistence

**Requirements:**

- Save conversation state on interruption
- Resume from checkpoint
- Generate recovery prompts

**Proposed Integration:**

1. Import `@agentsy/recovery` - snapshot and continuation helpers
2. Implement state persistence layer
3. Add recovery prompt generation

**Files to Modify:**

- New file: `src/session-recovery.ts` - recovery logic
- `src/provider.ts` - hook into cancellation path

**Effort:** HIGH (~8-10 hours)
**Risk:** HIGH (state management complexity; extensive testing needed)

**Status:** `BACKLOG - Post-v2.2.0, align with VS Code session API`

---

## Summary of Changes Needed

### Committed ✅

- Phase 1: Core Agentsy integration complete (commits 388daf5, cc4656d)

### In Progress / Ready to Start 🟡

- Phase 2: Tool call enhancement (LOW effort, HIGH value, ready to start)

### Backlog 📋

- Phase 3: Extended thinking (blocked on Mistral SDK support)
- Phase 4: Structured output validation (low priority)
- Phase 5: Context optimization (defer until needed)
- Phase 6: Recovery & persistence (high complexity, post-MVP)

---

## Adoption Checklist

### Integration Layer (`@agentsy/vscode`)

- ✅ `ApiKeyManager` — secrets integration
- ✅ `createVSCodeChatRenderer` — main chat handler
- ✅ `createVSCodeAgentLoop` — participant handler
- ✅ `cancellationTokenToAbortSignal` — token conversion
- 🔴 `ToolCallDeltaAccumulator` — replaces manual delta accumulation (Phase 2b)
- 🔴 `accumulateToolCallDeltas` — feed partial tool call deltas (Phase 2b)
- 🔴 `toVSCodeToolCallPart` — convert to VS Code ToolCallPart format (Phase 2b)
- 🔴 `mapUsageToVSCode` — map usage tokens to VS Code shape (Phase 2b)
- 🟡 `BaseLanguageModelChatProvider` — evaluate as base class for our provider
- 🟡 `UsageStatusBar` — quota tracking UI (not yet explored)
- 🟡 `McpServerRegistry` — MCP server definition pattern (not yet explored)
- 🟡 `createMcpServerDefinitionProvider` — MCP provider API helper (not yet explored)
- 🟡 `SettingsLoader` — typed config validation (not yet explored)
- 🟡 `stream-bridge` — new module in vscode package; investigate purpose
- 🧪 `createMockApiKeyManager` — test stub (not yet used in our tests)
- 🧪 `createMockRendererHandle` — test stub (not yet used in our tests)
- 🧪 `createChunkNormalizerStub` — test stub (not yet used in our tests)

### Stream Processing (`@agentsy/processor`)

- ✅ `LLMStreamProcessor` — event-driven stream orchestration
- 🟡 Tool call accumulation (using processor, but should leverage `@agentsy/vscode` helpers)

### Normalization (`@agentsy/normalizers`)

- ✅ `normalizeMistralChunk` — stream chunk normalization

### Message Conversion (`@agentsy/adapters`) — NOT YET INSTALLED

- 🔴 `toMistralMessages()` — replaces manual message construction + tool ID normalization (Phase 2a)
- 🔴 `processRawStream()` — replaces manual normalize+process loop (Phase 2a)
- 🟡 `processStream()` — for already-normalized streams
- 🟡 `createGenericAdapter()` — callback-based adapter pattern
- 🟡 `runStructuredDecisionFromRawStream()` — structured output flow
- 🟡 `applyDecisionAction()` — decision gate for side effects

### Utility Packages

- 🟡 `@agentsy/tool-calls` — XML tool-call helpers; `extractXmlToolCalls()` useful alongside `ToolCallDeltaAccumulator`
- 🟡 `@agentsy/thinking` — thinking block extraction (blocked: Mistral SDK support TBD)
- 🟡 `@agentsy/structured` — JSON parsing + repair for tool arguments
- 🟡 `@agentsy/context` — context dedup + optimization
- 🟡 `@agentsy/recovery` — session recovery (high effort, post-MVP)
- 🟡 `@agentsy/xml-filter` — XML tag filtering + privacy scrubbing (new, not previously in plan)
- ⚪ `@agentsy/formatting` — text sanitization
- ⚪ `@agentsy/agent` — multi-step coordination
- ⚪ `@agentsy/sse` — SSE transport (not relevant)
- ⚪ `@agentsy/ui` — AG-UI state store (not relevant)
- ⚪ `@agentsy/ag-ui` — AG-UI protocol (not relevant)

---

## Next Steps

1. **Immediate (This Week):**
   - 🔴 Implement Phase 2a: add `@agentsy/adapters`, replace `toMistralMessages()` and `processRawStream()`
   - 🔴 Implement Phase 2b: replace tool call delta accumulation with `ToolCallDeltaAccumulator` + `toVSCodeToolCallPart` from `@agentsy/vscode`
   - 🧪 Wire in test stubs (`createMockApiKeyManager`, `createMockRendererHandle`) in `src/provider.test.ts`

2. **Short Term (Next Sprint):**
   - 🟡 Explore `@agentsy/vscode` `SettingsLoader` and replace raw config reads
   - 🟡 Evaluate `BaseLanguageModelChatProvider` as base class
   - 🟡 Investigate `stream-bridge.ts` purpose and if it simplifies our streaming path
   - 🟡 Add `@agentsy/xml-filter` for privacy scrubbing of LLM outputs

3. **Medium Term:**
   - 🔬 Research Mistral extended thinking support → unblock Phase 3 + `@agentsy/thinking`
   - 📋 Design Phase 4 structured output validation with `@agentsy/structured`
   - ⚙️ Evaluate `@agentsy/context` for context window optimization

4. **Long Term:**
   - 🎯 Phase 6 recovery layer with `@agentsy/recovery`
   - 📈 Add `UsageStatusBar` for quota tracking UI
   - 🔄 Monitor Agentsy roadmap for new packages and export additions

---

## References

- Agentsy Package Catalog: <https://agentsy.self.agency/packages.html>
- Architecture Overview: <https://agentsy.self.agency/>
- `@agentsy/adapters` source: <https://github.com/selfagency/agentsy/tree/main/packages/adapters/src/adapters>
- `@agentsy/normalizers` source: <https://github.com/selfagency/agentsy/tree/main/packages/normalizers/src>
- `@agentsy/vscode` source: <https://github.com/selfagency/agentsy/tree/main/packages/vscode/src>
- Current PR: <https://github.com/selfagency/mistral-models-vscode/pull/18>
- Commits: 388daf5 (Phase 1a), cc4656d (Phase 1b)
