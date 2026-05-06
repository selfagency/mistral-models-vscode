# Agentsy Integration: Remediation Status & Roadmap

**Last Updated:** May 6, 2026
**Current Phase:** 2 (Tool Call + Adapter Adoption) - ✅ COMPLETE
**Next Phase:** 3 (Extended Thinking) - 🟡 BLOCKED (upstream support)

---

## Completion Update (May 6, 2026)

### ✅ Phase 2 Completed

- Adopted `@agentsy/adapters` for outbound message conversion (`toMistralMessages`) and stream processing (`processRawStream`).
- Replaced dynamic runtime helper discovery with static `@agentsy/vscode` helper usage:
  - `ToolCallDeltaAccumulator`
  - `accumulateToolCallDeltas`
  - `toVSCodeToolCallPart`
  - `mapUsageToVSCode`
- Added `@agentsy/tool-calls` XML fallback extraction (`extractXmlToolCalls`) in streaming text path.
- Added `@agentsy/xml-filter` stream scrubbing (`createXmlStreamFilter`) to sanitize rendered markdown output.
- Validation status:
  - `pnpm test` ✅
  - `pnpm run compile` ✅

### ✅ Base Provider Evaluation Complete

`BaseLanguageModelChatProvider` from `@agentsy/vscode` was evaluated and **not adopted** at this time.

**Decision:** keep current provider implementation based on composition utilities.

**Rationale:**

1. Current provider uses Mistral-specific multimodal/tool conversion and explicit VS Code part emission semantics that are already production-tested.
2. The current stream pipeline relies on `processRawStream` + direct `OutputPart` handling + XML fallback extraction, which would require additional adapter layers to fit the base-class abstraction.
3. Migrating to the base class now would be largely architectural churn with low short-term user impact and non-trivial regression risk.

**Revisit trigger:** if we add a second provider backend (multi-vendor architecture) or need unified provider lifecycles across multiple engines.

---

## Completed Work ✅

### ✅ Phase 1: Core Agentsy Integration (100% Complete)

**Objective:** Standardize on @agentsy/vscode renderers and eliminate code duplication

**Commits:**

- `388daf5` - Integrate createVSCodeChatRenderer, consolidate imports, fix build config
- `cc4656d` - Fix type narrowing for model list iteration

**Changes:**

1. ✅ **Eliminated duplication:** Removed local `cancellationTokenToAbortSignal` function
2. ✅ **Main chat rendering:** Integrated `createVSCodeChatRenderer` for markdown output
3. ✅ **Adapter pattern:** Created wrapper for Progress → AgentsyChatResponseStreamCompat
4. ✅ **Tool emission:** Extracted `_emitToolParts()` method (text handled by renderer)
5. ✅ **Null safety:** Added `if (!this.client)` checks before API calls
6. ✅ **Build config:** Marked @agentsy packages as external (prevent bundling)
7. ✅ **Type safety:** Improved type narrowing using `in` operator for discriminated unions

**Verification:**

- ✅ TypeScript compilation: 0 errors
- ✅ Linting: 0 warnings
- ✅ Build: Success (1.64 MB bundle)
- ✅ PR #18: Created and ready for review

**Code Quality:**

- Both chat and participant handlers now use official Agentsy renderers
- Single-source-of-truth for token conversion
- Improved null safety throughout
- Cleaner separation of concerns (renderer vs tool emission)

---

## In Progress 🟡

### 🟡 Phase 2: Tool Call Enhancement (Design Phase)

**Objective:** Unify tool call handling using @agentsy/tool-calls

**Status:** READY TO START - No blockers

**Current Manual Implementation:**

- Lines 268-271: `toolCallIdMapping` and `reverseToolCallIdMapping` (custom ID mapping)
- Lines 326-346: `generateToolCallId()` and `getOrCreateVsCodeToolCallId()` (custom ID generation)
- Lines 995-1005: Manual tool call emission in `_emitToolParts()`
- Tool call validation in `validateToolMessages()` (lines 1020-1050)

**Proposed Changes:**

1. Import `@agentsy/tool-calls`:
   - `extractXmlToolCalls()` - parse tool calls from XML
   - `ToolCallAccumulator` - accumulate partial calls
2. Replace manual ID mapping with Agentsy abstraction
3. Leverage processor's tool call accumulation

**Estimated Effort:** 2 hours
**Risk Level:** LOW (tool call flow is stable)
**Timeline:** Can start immediately

---

## Backlog / Future Phases 📋

### 🟡 Phase 3: Extended Thinking Support

**Objective:** Support models with extended thinking (Claude, future Mistral)

**Status:** BLOCKED - Awaiting Mistral SDK extended thinking support

**What's Needed:**

- Extract thinking blocks separately
- Display thinking in UI (if VS Code API allows)
- Pass thinking context forward

**Effort:** MEDIUM (4 hours)
**Risk:** MEDIUM (UI display exploration needed)
**Dependency:** Mistral SDK must support extended thinking

---

### 🟡 Phase 4: Structured Output Validation

**Objective:** Validate and repair structured outputs

**Status:** BACKLOG - Lower priority; manual parsing sufficient for now

**Use Cases:**

- Validate tool call parameters before sending
- Repair malformed JSON responses
- Handle streaming JSON

**Effort:** LOW (2 hours)
**Risk:** LOW (defensive measure)

---

### 🟡 Phase 5: Context Optimization

**Objective:** Dedup and optimize context window usage

**Status:** BACKLOG - Defer until context limit issues arise

**Features:**

- Track window usage
- Dedup repeated references
- Smart message filtering

**Effort:** MEDIUM (4-6 hours)
**Risk:** MEDIUM (changes message flow)

---

### 🟡 Phase 6: Recovery & Session Persistence

**Objective:** Resume interrupted conversations

**Status:** BACKLOG - High complexity, post-MVP

**Features:**

- Save conversation state on interruption
- Resume from checkpoint
- Generate recovery prompts

**Effort:** HIGH (8-10 hours)
**Risk:** HIGH (state management complexity)
**Timeline:** Post-v2.2.0

---

## Package Integration Status

### Core Integration Layer

| Package                | Status        | Used For                                             | Coverage                                                       |
| ---------------------- | ------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| `@agentsy/vscode`      | ✅ INTEGRATED | Chat renderer, agent loop, secrets, token conversion | ApiKeyManager, createVSCodeChatRenderer, createVSCodeAgentLoop |
| `@agentsy/processor`   | ✅ INTEGRATED | Stream orchestration, tool call accumulation         | LLMStreamProcessor, text/tool events                           |
| `@agentsy/normalizers` | ✅ INTEGRATED | Chunk normalization                                  | normalizeMistralChunk                                          |

### Proposed Integrations

| Package               | Phase | Status  | Priority |
| --------------------- | ----- | ------- | -------- |
| `@agentsy/tool-calls` | 2     | READY   | HIGH     |
| `@agentsy/thinking`   | 3     | BLOCKED | MEDIUM   |
| `@agentsy/structured` | 4     | BACKLOG | MEDIUM   |
| `@agentsy/context`    | 5     | BACKLOG | MEDIUM   |
| `@agentsy/recovery`   | 6     | BACKLOG | HIGH     |

### Not Planned

| Package          | Reason                                   |
| ---------------- | ---------------------------------------- |
| `@agentsy/sse`   | Not applicable (we use direct streaming) |
| `@agentsy/ui`    | Designed for AG-UI, not VS Code          |
| `@agentsy/ag-ui` | Protocol bridge not relevant             |

---

## Key Metrics & Health

| Metric                   | Current   | Target    | Status                 |
| ------------------------ | --------- | --------- | ---------------------- |
| Agentsy package adoption | 3/16      | 5/16      | 🟡 On track            |
| Manual tool call code    | ~80 lines | ~10 lines | 🟡 Phase 2 ready       |
| Type coverage            | Good      | Excellent | 🟢 Improved in Phase 1 |
| Build size               | 1.64 MB   | 1.64 MB   | 🟢 No growth           |
| Compilation time         | 463ms     | <500ms    | 🟢 Acceptable          |

---

## Risks & Mitigations

| Risk                                      | Severity | Mitigation                                            |
| ----------------------------------------- | -------- | ----------------------------------------------------- |
| Breaking change in @agentsy packages      | MEDIUM   | Pin versions, run full test suite before upgrade      |
| Extended thinking API delay               | MEDIUM   | Design Phase 3 in parallel, defer implementation      |
| Tool call refactor introduces regressions | LOW      | Comprehensive test coverage, canary release           |
| Context optimization complexity           | HIGH     | Implement as separate module, integrate incrementally |

---

## Success Criteria

### Phase 1 (Completed)

- ✅ Both chat/participant handlers use Agentsy renderers
- ✅ Build passes TypeScript/lint/compilation
- ✅ PR #18 approved and merged
- ✅ No regressions in existing functionality

### Phase 2 (Ready to Start)

- 🔲 Tool call handling unified via @agentsy/tool-calls
- 🔲 50% reduction in manual tool call code
- 🔲 All tool call tests pass
- 🔲 Performance maintains <500ms roundtrip

### Future Phases

- 🔲 Extended thinking displays correctly in UI
- 🔲 Structured outputs validate before sending
- 🔲 Context optimization reduces message count by 10%+
- 🔲 Recovery mechanism enables conversation resume

---

## Action Items

### Immediate (This Week)

- [ ] Review & approve PR #18
- [ ] Merge Phase 1 changes to main
- [ ] Schedule Phase 2 design review
- [ ] Explore @agentsy/vscode additional capabilities

### Short Term (Next Sprint)

- [ ] Implement Phase 2 (tool call enhancement)
- [ ] Add test coverage for tool call edge cases
- [ ] Document tool call flow for maintainers
- [ ] Benchmark tool call latency

### Medium Term (Next Release)

- [ ] Research Mistral extended thinking timeline
- [ ] Design Phase 6 recovery mechanism
- [ ] Plan context optimization strategy

### Long Term

- [ ] Implement full recovery/persistence
- [ ] Monitor Agentsy roadmap
- [ ] Consider @agentsy/agent for multi-step flows

---

## Reference Links

- **Agentsy Catalog:** <https://agentsy.self.agency/packages.html>
- **Adoption Plan:** ./AGENTSY_ADOPTION_PLAN.md
- **PR #18:** <https://github.com/selfagency/mistral-models-vscode/pull/18>
- **Recent Commits:** 388daf5, cc4656d
