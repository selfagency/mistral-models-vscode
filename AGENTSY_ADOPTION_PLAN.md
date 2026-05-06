# Agentsy Package Adoption Plan

## Executive Summary

The Mistral VS Code extension is currently using **3 of 16 published Agentsy packages**. This document outlines the full adoption opportunity, prioritizes high-impact integrations, and tracks implementation progress.

**Current Status:**
- ✅ Core renderer + stream orchestration: 100% adoption
- 🟡 Tool call handling: Manual implementation (can be enhanced)
- ⚠️ Context management: Not used
- ⚠️ Recovery/resilience: Not used

---

## Agentsy Ecosystem Overview

### Currently Adopted ✅

| Package | Version | Role | Usage | Priority |
|---------|---------|------|-------|----------|
| `@agentsy/vscode` | ^0.1.0 | VS Code integration, rendering, settings | ApiKeyManager, createVSCodeChatRenderer, createVSCodeAgentLoop, cancellationTokenToAbortSignal | CRITICAL |
| `@agentsy/normalizers` | ^0.1.2 | Response normalization | normalizeMistralChunk for Mistral stream chunks | CRITICAL |
| `@agentsy/processor` | ^0.1.2 | Stream orchestration, event pipeline | LLMStreamProcessor for streaming text/tool call accumulation | CRITICAL |

### High-Priority Adoption Candidates 🎯

| Package | Role | Why Relevant | Effort | Benefit |
|---------|------|--------------|--------|---------|
| `@agentsy/tool-calls` | XML & native tool-call helpers | Currently manually handling tool call ID mapping; could unify parsing | LOW | HIGH |
| `@agentsy/thinking` | Incremental thinking extraction | Support extended thinking models (Claude, future Mistral); extract thinking blocks | MEDIUM | MEDIUM |
| `@agentsy/structured` | JSON parsing, repair, validation | Handle structured outputs, repair malformed JSON | LOW | MEDIUM |
| `@agentsy/context` | Context extraction, dedupe, normalization | Optimize context window usage, dedup references | MEDIUM | MEDIUM |
| `@agentsy/recovery` | Recovery snapshots, continuation prompts | Resume interrupted conversations, save state | HIGH | HIGH |

### Medium-Priority Candidates 🟡

| Package | Role | Applicability | Effort | Note |
|---------|------|---------------|--------|------|
| `@agentsy/agent` | Multi-step agent loop | Already using simpler createVSCodeAgentLoop | MEDIUM | Consider if multi-step coordination needed |
| `@agentsy/adapters` | Stream pipeline wrappers | Integration layer; may overlap with vscode package | MEDIUM | Research overlap first |
| `@agentsy/formatting` | Text sanitization, display formatting | Could improve rendering of tool results | LOW | Defensive measure for display safety |
| `@agentsy/renderers` | Plain-text rendering primitives | Already using vscode renderer; this is lower-level | MEDIUM | Reference for understanding rendering patterns |

### Low-Priority / Out-of-Scope 📋

| Package | Reason |
|---------|--------|
| `@agentsy/sse` | Server-sent-event parsing; we use direct streaming, not SSE |
| `@agentsy/ui` | Conversation state store; designed for AG-UI protocol, not VS Code |
| `@agentsy/ag-ui` | AG-UI protocol bridge; not relevant for VS Code extension |
| `@agentsy/types` | Shared type contracts; useful for reference but no direct integration |

---

## Remediation Plan & Progress Tracking

### Phase 1: Core Refactoring ✅ COMPLETE

**Objective:** Standardize on Agentsy renderers across all code paths

| Item | Status | Commit | Details |
|------|--------|--------|---------|
| 1.1 Consolidate cancellationTokenToAbortSignal | ✅ DONE | 388daf5 | Removed local duplicate, imported from @agentsy/vscode |
| 1.2 Integrate createVSCodeChatRenderer | ✅ DONE | 388daf5 | Main chat handler now uses official renderer |
| 1.3 Simplify createVSCodeAgentLoop | ✅ DONE | 388daf5 | Removed unsupported callbacks |
| 1.4 Fix type narrowing in model iteration | ✅ DONE | cc4656d | Improved type guards using `in` operator |
| 1.5 Update build config for external deps | ✅ DONE | 388daf5 | Mark @agentsy/* packages as external in tsup |

**Result:** Both chat and participant handlers use consistent Agentsy renderers. PR #18 ready for review.

---

### Phase 2: Tool Call Enhancement 🟡 IN PROGRESS

**Objective:** Unify tool call handling using @agentsy/tool-calls

**Current State:**
- Manual tool call ID mapping (toolCallIdMapping, reverseToolCallIdMapping)
- Manual tool call extraction from streaming
- Manual tool call validation

**Proposed Changes:**
1. Import `@agentsy/tool-calls` helpers:
   - `extractXmlToolCalls()` - parse tool calls from XML blocks
   - `ToolCallAccumulator` - accumulate partial tool calls from deltas
2. Replace manual ID mapping with Agentsy helpers
3. Leverage existing accumulator in processor instead of custom logic

**Files to Modify:**
- `src/provider.ts` - lines 268-346 (tool call ID mapping), lines 980-1020 (_emitToolParts)

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
- ✅ ApiKeyManager for secrets integration
- ✅ createVSCodeChatRenderer for main handler
- ✅ createVSCodeAgentLoop for participant handler
- ✅ cancellationTokenToAbortSignal for token conversion
- 🟡 Settings helpers (not yet explored)
- 🟡 Usage tracking helpers (not yet explored)
- 🟡 MCP integration helpers (not yet explored)

### Stream Processing (`@agentsy/processor`)
- ✅ LLMStreamProcessor for event-driven orchestration
- 🟡 Tool call accumulation (using processor, but could leverage @agentsy/tool-calls)

### Normalization (`@agentsy/normalizers`)
- ✅ normalizeMistralChunk for stream chunking

### Utility Packages (Not Yet Integrated)
- 🟡 `@agentsy/tool-calls` - tool call helpers
- 🟡 `@agentsy/thinking` - thinking extraction
- 🟡 `@agentsy/structured` - JSON handling
- 🟡 `@agentsy/context` - context dedup
- 🟡 `@agentsy/recovery` - session recovery
- ⚪ `@agentsy/formatting` - text sanitization
- ⚪ `@agentsy/agent` - multi-step coordination
- ⚪ `@agentsy/adapters` - stream wrappers

---

## Next Steps

1. **Immediate (This Week):**
   - ✅ Verify Phase 1 complete via PR #18
   - 📋 Design Phase 2 tool call refactor
   - 🔍 Explore `@agentsy/vscode` settings/usage/MCP helpers

2. **Short Term (Next Sprint):**
   - 🚀 Implement Phase 2 (tool call enhancement)
   - 📊 Add telemetry for context window tracking (prep for Phase 5)
   - 🧪 Expand test coverage for tool call flow

3. **Medium Term:**
   - 🔬 Research Mistral extended thinking support
   - 📋 Design Phase 6 recovery mechanism
   - ⚙️ Evaluate @agentsy/adapters for additional abstraction

4. **Long Term:**
   - 🎯 Implement full recovery/persistence layer
   - 📈 Add context optimization when needed
   - 🔄 Monitor Agentsy roadmap for new packages

---

## References

- Agentsy Package Catalog: https://agentsy.self.agency/packages.html
- Architecture Overview: https://agentsy.self.agency/ (main docs)
- Current PR: https://github.com/selfagency/mistral-models-vscode/pull/18
- Commits: 388daf5 (Phase 1a), cc4656d (Phase 1b)
