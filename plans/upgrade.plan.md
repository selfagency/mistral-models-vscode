# Mistral Models VS Code Extension — Implementation Plan

**Repository:** <https://github.com/selfagency/mistral-models-vscode>
**Scope:** Fix 40+ issues + upgrade to llm-stream-parser best practices
**Timeline:** 4 weeks (4 phases)
**Effort:** ~80-100 hours
**Status:** Draft — Ready for approval and phased execution

---

## Executive Summary

Based on the comprehensive code review, the mistral-models-vscode extension has a solid foundation (B+ grade, 77/100) but requires systematic improvements across 5 dimensions:

1. **Critical Fixes** (5 issues) — Block production readiness
2. **Important Fixes** (15 issues) — Required for robustness
3. **LLM Stream Parser Optimization** (4 areas) — Align with llm-stream-parser best practices
4. **Testing & CI** (12 gaps) — Ensure code quality
5. **Build & Packaging** (6 issues) — Reduce technical debt

**Estimated Impact:**

- ✅ Production-ready extension that reliably handles edge cases
- ✅ Improved reliability through robust retry, cancellation, and error handling
- ✅ Better user experience through correct token limits, event firing, and tool invocation
- ✅ Easier maintenance through comprehensive tests and cleaner code
- ✅ Aligned with llm-stream-parser philosophy (coordinated stream processing, proper flushing)

---

## Phase Overview

| Phase       | Duration | Focus                                 | Deliverable                              |
| ----------- | -------- | ------------------------------------- | ---------------------------------------- |
| **Phase 0** | Days 1-2 | Dependency audit & package upgrade    | Compatible with latest llm-stream-parser |
| **Phase 1** | Week 1   | Critical fixes + high-priority issues | Production-ready release                 |
| **Phase 2** | Week 2   | LLM Stream Parser optimization        | Enhanced stream processing               |
| **Phase 3** | Week 3   | Testing & error scenarios             | Comprehensive test suite                 |
| **Phase 4** | Week 4   | Polish & technical debt               | Release v2.0.0                           |

---

## Phase 0: Dependency Audit & Package Upgrade (Days 1-2)

**Goal:** Ensure mistral-models-vscode targets the latest stable llm-stream-parser and migrate to new APIs if applicable

**Duration:** 8 hours

### 0.1 Audit llm-stream-parser Version & Breaking Changes

**Current State:**

```json
{
  "dependencies": {
    "@selfagency/llm-stream-parser": "^0.1.5"
  }
}
```

**Tasks:**

1. Check latest version:

```bash
npm view @selfagency/llm-stream-parser versions --json | tail -5
npm view @selfagency/llm-stream-parser dist-tags
```

1. Read CHANGELOG & release notes:

```bash
# From llm-stream-parser repo
cat CHANGELOG.md  # Identify breaking changes
```

1. Document findings:

```markdown
# Version Audit Results

## Current: v0.1.5

- Release date: [date]
- Key features: [list]

## Latest: v[X.Y.Z]

- Release date: [date]
- New features: [list]
- Breaking changes:
  - [ ] Normalizer interface changed?
  - [ ] Processor API changed?
  - [ ] Event names changed?
  - [ ] Type exports changed?
  - [ ] Usage/output shape changed?
```

**Estimated Effort:** 1.5 hours

---

### 0.2 Create Migration Guide (if breaking changes detected)

**If upgradable without breaking changes:**

```bash
npm update @selfagency/llm-stream-parser
npm install  # Update package-lock.json
```

**If breaking changes exist:**

Create file: `docs/llm-stream-parser-migration.md`

```markdown
# Migration Guide: llm-stream-parser v0.1.5 → v[X.Y.Z]

## Breaking Changes

### 1. Normalizer Interface

**Old:**
\`\`\`typescript
const normalized = normalizeOllamaChatChunk(chunk);
\`\`\`

**New:**
\`\`\`typescript
const normalized = normalizeOllamaChatChunk(chunk, { feature: true });
\`\`\`

### 2. Processor Event Names

**Old:** `processor.on('tool_call', ...)`
**New:** `processor.on('tool_calls', ...)`

... (document each breaking change)

## Migration Steps

1. Update package.json: `@selfagency/llm-stream-parser: ^X.Y.Z`
2. Update import statements (if exports changed)
3. Update processor event listeners
4. Run tests to verify compatibility
5. Update normalizer usage (if interface changed)
```

**Estimated Effort:** 2 hours

---

### 0.3 Test Compatibility Before Committing

**Create temporary branch:**

```bash
git checkout -b test/llm-stream-parser-upgrade
npm update @selfagency/llm-stream-parser
npm install
```

**Run existing tests:**

```bash
npm run test:extension  # Should pass with new version
npm run type-check      # Verify types are compatible
```

**If tests fail:**

- Document breaking change
- Create adapter/shim layer if needed
- OR stay on current version with clear justification

**If tests pass:**

- Merge upgrade branch into main branch
- Document in CHANGELOG

**Estimated Effort:** 2 hours

---

### 0.4 Update Type Definitions & Imports

**Tasks:**

1. Check for type changes:

```bash
npm show @selfagency/llm-stream-parser@X.Y.Z | grep types
```

1. Update imports in `src/mistral-normalizer.ts`:

```typescript
// Verify these exports still exist
import type { StreamChunk } from '@selfagency/llm-stream-parser/processor';
import type { NativeToolCallDelta, FinishReason } from '@selfagency/llm-stream-parser/normalizers';
import { LLMStreamProcessor } from '@selfagency/llm-stream-parser';
```

1. Run `tsc --noEmit` to catch type errors

**Estimated Effort:** 1 hour

---

### 0.5 Update CI/CD & Peer Dependencies

**Update `.github/workflows/ci.yml`:**

```yaml
- name: Install dependencies
  run: npm ci # Uses exact versions from package-lock.json

- name: Type check
  run: npm run type-check

- name: Run tests
  run: npm run test:extension
```

**Update `package.json` if needed:**

```json
{
  "peerDependencies": {
    "@selfagency/llm-stream-parser": "^X.Y.Z"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**Estimated Effort:** 1.5 hours

---

### Phase 0 Summary

| Task                    | Effort      | Blocker            | Status                      |
| ----------------------- | ----------- | ------------------ | --------------------------- |
| Audit version & changes | 1.5h        | No                 | Pre-req for phases          |
| Create migration guide  | 2h          | If breaking        | Conditional                 |
| Test compatibility      | 2h          | Yes                | Must pass                   |
| Update types & imports  | 1h          | If upgrade         | Conditional                 |
| Update CI/CD            | 1.5h        | No                 | Polish                      |
| **Phase 0 Total**       | **8 hours** | **Blocks Phase 2** | **Complete before Phase 1** |

**Deliverable:** Mistral extension compatible with latest llm-stream-parser, with clear migration path documented

---

## Phase 1: Critical Fixes & Foundation (Week 1)

**Goal:** Make the extension production-ready by fixing 5 critical issues and 5 high-priority issues.

**Duration:** 40 hours

### 1.1 Fix Broken Dependabot Configuration

**Issue:** `package-ecosystem: ""` (empty) blocks automated security updates

**Current State:**

```yaml
# .github/dependabot.yml
package-ecosystem: '' # ← BROKEN
```

**Fix:**

```yaml
version: 2
updates:
  - package-ecosystem: 'npm'
    directory: '/'
    schedule:
      interval: 'weekly'
      day: 'monday'
      time: '03:00'
    open-pull-requests-limit: 10
    reviewers:
      - selfagency
    labels:
      - 'dependencies'
    commit-message:
      prefix: 'chore'
      include: 'scope'
```

**Files to Modify:**

- `.github/dependabot.yml`

**Testing:**

- Commit and verify Dependabot picks up dependencies in 24 hours
- Create manual test PR to verify workflow triggers

**Estimated Effort:** 30 minutes

---

### 1.2 Fix Per-Model `maxOutputTokens` (Critical)

**Issue:** All models use 4096 tokens; large models support 16k+. Causes 400 errors for large models.

**Current Code:**

```typescript
// src/provider.ts:42-44
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

const foundModel = models.find(m => m.id === model.id) ?? {
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
};
```

**Solution:**

1. Add model limits constant at top of `src/provider.ts`:

```typescript
const MODEL_OUTPUT_LIMITS: Record<string, number> = {
  'mistral-tiny-latest': 4096,
  'mistral-small-latest': 4096,
  'mistral-medium-latest': 8192,
  'mistral-large-latest': 16384,
  'codestral-latest': 8192,
  'devstral-latest': 16384,
  'pixtral-large-latest': 8192,
  'magistral-medium-latest': 8192,
  'magistral-small-latest': 4096,
};

const getModelOutputLimit = (modelId: string): number => {
  // Try exact match first
  if (modelId in MODEL_OUTPUT_LIMITS) {
    return MODEL_OUTPUT_LIMITS[modelId];
  }
  // Fallback: try pattern matching
  if (modelId.includes('large')) return 16384;
  if (modelId.includes('medium')) return 8192;
  return 4096; // Safe default
};
```

1. Update `provideLanguageModelChatResponse()` to use it:

```typescript
const maxOutputTokens = apiResponse.model.maxCompletionTokens ?? getModelOutputLimit(model.id);
```

1. Update mocked models in tests to have correct limits

**Files to Modify:**

- `src/provider.ts` (add constant, update logic)
- `src/provider.test.ts` (update test expectations)

**Testing:**

```typescript
// Add test
it('should use per-model maxOutputTokens limits', () => {
  expect(getModelOutputLimit('mistral-large-latest')).toBe(16384);
  expect(getModelOutputLimit('mistral-small-latest')).toBe(4096);
  expect(getModelOutputLimit('unknown-model')).toBe(4096); // fallback
});

// Integration test: verify large model can be selected without 400 error
```

**Estimated Effort:** 1 hour

---

### 1.3 Fire `onDidChangeLanguageModelChatInformation` on API Key Change

**Issue:** Model list doesn't refresh when user changes API key (H3)

**Current Code:**

```typescript
// src/provider.ts:338-348
async setApiKey(): Promise<string | undefined> {
  // ... user input ...
  await this.context.secrets.store('MISTRAL_API_KEY', apiKey);
  this.client = this.createClient(apiKey);
  this.fetchedModels = null;  // Cache cleared but event not fired
  return apiKey;
}
```

**Fix:**

```typescript
async setApiKey(): Promise<string | undefined> {
  // ... validation & input ...
  await this.context.secrets.store('MISTRAL_API_KEY', apiKey);
  this.client = this.createClient(apiKey);
  this.fetchedModels = null;

  // ← NEW: Fire event so VS Code refreshes model list
  this._onDidChangeLanguageModelChatInformation.fire(undefined);

  this.log.info('[Mistral] API key updated; model list refreshed');
  return apiKey;
}
```

**Files to Modify:**

- `src/provider.ts`

**Testing:**

```typescript
// Add to src/provider.test.ts
it('should fire onDidChangeLanguageModelChatInformation when API key changes', async () => {
  const firespy = vi.spyOn(provider['_onDidChangeLanguageModelChatInformation'], 'fire');
  await provider.setApiKey();
  expect(firespy).toHaveBeenCalledWith(undefined);
});
```

**Estimated Effort:** 45 minutes

---

### 1.4 Add ChatResponseTurn2 Support (Critical)

**Issue:** VS Code 1.96+ uses `ChatResponseTurn2`; current code skips it silently, losing context (H4)

**Current Code:**

```typescript
// Fragile version detection
const maybeChatResponseTurn2Ctor = (vscode as unknown as { ChatResponseTurn2?: ... })
  .ChatResponseTurn2;

for (const turn of chatContext.history) {
  if (turn instanceof vscode.ChatRequestTurn) {
    // ...
  } else if (turn instanceof vscode.ChatResponseTurn) {
    // ...
  } else if (maybeChatResponseTurn2Ctor && (turn as object) instanceof maybeChatResponseTurn2Ctor) {
    // Fragile handling
  }
}
```

**Fix:**

1. Create robust version detection helper:

```typescript
// src/provider.ts (near top)
const getChatResponseTurn2Constructor = (): typeof vscode.ChatResponseTurn | undefined => {
  const vsCodeApi = vscode as unknown as Record<string, unknown>;
  if (typeof vsCodeApi.ChatResponseTurn2 === 'function') {
    return vsCodeApi.ChatResponseTurn2 as typeof vscode.ChatResponseTurn;
  }
  return undefined;
};

const ChatResponseTurn2 = getChatResponseTurn2Constructor();
```

1. Update history extraction to handle both:

```typescript
for (const turn of chatContext.history) {
  if (turn instanceof vscode.ChatRequestTurn) {
    messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
  } else if (turn instanceof vscode.ChatResponseTurn) {
    const text = extractResponseText(turn.response);
    if (text) {
      messages.push(vscode.LanguageModelChatMessage.Assistant(text));
    }
  } else if (ChatResponseTurn2 && turn instanceof ChatResponseTurn2) {
    // New path for ChatResponseTurn2 (VS Code 1.96+)
    const responseParts = (turn as { response: readonly unknown[] }).response;
    const text = extractResponseText(responseParts);
    if (text) {
      messages.push(vscode.LanguageModelChatMessage.Assistant(text));
    }
  }
}
```

1. Helper function to extract text from both formats:

```typescript
const extractResponseText = (response: vscode.ChatResponsePart[] | readonly unknown[]): string => {
  if (!Array.isArray(response)) return '';

  return response
    .filter((part): part is vscode.ChatResponseMarkdownPart => part instanceof vscode.ChatResponseMarkdownPart)
    .map(part => part.value.value)
    .join('');
};
```

**Files to Modify:**

- `src/provider.ts` (add helper, update history extraction)
- `src/provider.test.ts` (add test for ChatResponseTurn2)

**Testing:**

```typescript
it('should handle ChatResponseTurn2 if available', async () => {
  // Mock ChatResponseTurn2
  const mockTurn2 = {
    response: [new vscode.ChatResponseMarkdownPart(new vscode.MarkdownString('Response text'))],
  };

  // Verify extractResponseText handles it
  const text = extractResponseText(mockTurn2.response);
  expect(text).toBe('Response text');
});
```

**Estimated Effort:** 1.5 hours

---

### 1.5 Implement TTL Cache for Model List

**Issue:** Models cached forever; new Mistral models don't appear until restart (M1)

**Current Code:**

```typescript
private fetchedModels: MistralModelListItem[] | null = null;
// Cache never invalidates
```

**Fix:**

1. Add timestamp tracking:

```typescript
private fetchedModels: MistralModelListItem[] | null = null;
private modelsCacheExpiry: number = 0;
private readonly MODELS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

private isCacheExpired(): boolean {
  return Date.now() > this.modelsCacheExpiry;
}
```

1. Update `provideLanguageModelChatInformation()`:

```typescript
async provideLanguageModelChatInformation(
  options: { silent: boolean },
  token: CancellationToken,
): Promise<LanguageModelChatInformation[]> {
  // NEW: Check if cache is expired
  if (this.fetchedModels && !this.isCacheExpired()) {
    this.log.debug('[Mistral] Using cached models (expires in ' +
      Math.round((this.modelsCacheExpiry - Date.now()) / 1000) + 's)');
    return this.fetchedModels;
  }

  const models = await this.fetchModels();
  this.modelsCacheExpiry = Date.now() + this.MODELS_CACHE_TTL_MS;

  // ... rest of logic ...
}
```

1. Clear cache on API key change:

```typescript
async setApiKey(): Promise<string | undefined> {
  // ...
  this.fetchedModels = null;
  this.modelsCacheExpiry = 0;  // ← NEW: Force refresh
  this._onDidChangeLanguageModelChatInformation.fire(undefined);
  // ...
}
```

**Files to Modify:**

- `src/provider.ts` (add cache tracking, TTL logic)
- `src/provider.test.ts` (test cache expiry)

**Testing:**

```typescript
it('should refresh model list after 30 minutes', async () => {
  const provider = createProvider();

  // Mock first fetch
  await provider.provideLanguageModelChatInformation({ silent: false }, token);
  expect(mockFetch).toHaveBeenCalledTimes(1);

  // Second fetch should use cache
  await provider.provideLanguageModelChatInformation({ silent: false }, token);
  expect(mockFetch).toHaveBeenCalledTimes(1); // No new call

  // Advance time past TTL
  vi.useFakeTimers();
  vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes
  vi.useRealTimers();

  // Now should fetch again
  await provider.provideLanguageModelChatInformation({ silent: false }, token);
  expect(mockFetch).toHaveBeenCalledTimes(2); // New call made
});
```

**Estimated Effort:** 1 hour

---

### 1.6 Map Raw Error Messages to User-Friendly Text

**Issue:** Raw Mistral SDK errors expose details and are confusing to users (M4)

**Current Code:**

```typescript
} catch (error) {
  this.log.error('[Mistral] Chat request failed: ' + String(error));
  throw error;  // ← Raw error to user
}
```

**Fix:**

1. Create error mapper:

```typescript
// src/provider.ts
const getUserFriendlyError = (error: unknown): string => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // API key errors
    if (message.includes('401') || message.includes('unauthorized') || message.includes('invalid api')) {
      return 'Invalid or expired API key. Please check your Mistral API key in settings.';
    }

    // Rate limit
    if (message.includes('429') || message.includes('rate limit')) {
      return 'Too many requests. Please wait a moment and try again.';
    }

    // Model not found
    if (message.includes('404') || message.includes('model not found')) {
      return 'Model not found. Please check that the model is available in your account.';
    }

    // Network errors
    if (message.includes('timeout') || message.includes('etimedout')) {
      return 'Request timed out. Please check your internet connection and try again.';
    }

    // Fallback: extract first line only
    const firstLine = error.message.split('\n')[0];
    return firstLine.length > 100 ? firstLine.substring(0, 97) + '...' : firstLine;
  }

  return 'An unknown error occurred. Please try again.';
};
```

1. Use in error handling:

```typescript
try {
  const stream = await withRetry(() => this.client!.chat.stream(requestPayload), token);
  // ... streaming logic ...
} catch (chatError) {
  const message = getUserFriendlyError(chatError);
  progress.report(new LanguageModelTextPart(`\n\n**Error:** ${message}\n`));
  this.log.error('[Mistral] Chat request failed: ' + String(chatError));
  throw chatError;
}
```

**Files to Modify:**

- `src/provider.ts` (add error mapper, use in handlers)
- `src/provider.test.ts` (test error mapping)

**Testing:**

```typescript
it('should map API errors to user-friendly messages', () => {
  expect(getUserFriendlyError(new Error('401: Unauthorized'))).toContain('Invalid or expired API key');

  expect(getUserFriendlyError(new Error('429: Rate limit exceeded'))).toContain('Too many requests');
});
```

**Estimated Effort:** 45 minutes

---

### 1.7 Skip Malformed Tool Calls on Flush

**Issue:** If tool call JSON never becomes valid, still emitted to VS Code with garbage args (M2)

**Current Code:**

```typescript
// On stream finish, emit buffered tool calls
for (const [vsCodeId, buf] of toolCallBuffers) {
  if (emittedToolCalls.has(vsCodeId) || !buf.name) {
    continue;
  }
  try {
    const parsedArgs = buf.argsText ? JSON.parse(buf.argsText) : {};
    progress.report(new LanguageModelToolCallPart(vsCodeId, buf.name, parsedArgsObj));
  } catch {
    // Silent failure
  }
}
```

**Fix:**

```typescript
// On stream finish, emit buffered tool calls
for (const [vsCodeId, buf] of toolCallBuffers) {
  if (emittedToolCalls.has(vsCodeId) || !buf.name) {
    continue;
  }
  try {
    const parsedArgs = buf.argsText ? JSON.parse(buf.argsText) : {};
    progress.report(new LanguageModelToolCallPart(vsCodeId, buf.name, parsedArgsObj));
    emittedToolCalls.add(vsCodeId);
  } catch (parseError) {
    // Report error instead of silently skipping
    const errorMsg = `Tool "${buf.name}" produced invalid arguments: ${String(parseError)}`;
    this.log.warn('[Mistral] ' + errorMsg);
    progress.report(
      new LanguageModelTextPart(`\n\n**⚠️ Warning:** ${errorMsg}\n` + `Raw arguments: \`${buf.argsText}\`\n\n`),
    );
    // Don't emit the tool call
  }
}
```

**Files to Modify:**

- `src/provider.ts` (update flush logic)
- `src/provider.test.ts` (test invalid JSON handling)

**Testing:**

```typescript
it('should report error for malformed tool call arguments', async () => {
  const mockProgress = createMockProgress();

  // Simulate tool call with unclosed JSON
  const toolCallBuffer = {
    name: 'search',
    argsText: '{"q":"incomplete', // Invalid JSON
  };

  // Manually test flush logic
  // ... should call progress.report with error message
});
```

**Estimated Effort:** 45 minutes

---

### Phase 1 Summary

| Task                         | Effort         | Priority     |
| ---------------------------- | -------------- | ------------ |
| Fix Dependabot               | 0.5h           | P0           |
| Per-model token limits       | 1h             | P0           |
| Fire event on API key change | 0.75h          | P0           |
| ChatResponseTurn2 support    | 1.5h           | P0           |
| TTL cache                    | 1h             | P0           |
| User-friendly errors         | 0.75h          | P0           |
| Skip malformed tool calls    | 0.75h          | P0           |
| **Phase 1 Total**            | **6.25 hours** | **P0**       |
| Testing & validation         | 2h             | P0           |
| **Phase 1 with Testing**     | **~8 hours**   | **Complete** |

**Deliverable:** Bugfix release (v1.1.0) with all critical issues resolved

---

## Phase 2: LLM Stream Parser Optimization (Week 2)

**Goal:** Adopt llm-stream-parser best practices and upgrade integration

**Duration:** 30 hours

### 2.1 Use LLMStreamProcessor for Tool Call Accumulation

**Issue:** Tool calls are manually buffered; LLMStreamProcessor has `ToolCallAccumulator` feature

**Opportunity:** Leverage processor's `nativeToolCallDeltas` handling for cleaner accumulation

**Current Approach:**

```typescript
// Manual buffering
const toolCallBuffers = new Map<string, { name?: string; argsText: string }>();
// ... complex accumulation logic ...
```

**New Approach with LLMStreamProcessor:**

```typescript
import type { ToolCallState, XmlToolCall } from '@selfagency/llm-stream-parser/tool-calls';

// LLMStreamProcessor already handles native tool call delta accumulation
// when accumulateNativeToolCalls: true
const streamProcessor = new LLMStreamProcessor({
  parseThinkTags: true,
  scrubContextTags: true,
  enforcePrivacyTags: true,
  accumulateNativeToolCalls: true, // ← NEW: Accumulate deltas
  knownTools: new Set(supportedToolNames), // ← Provide tool list for validation
  onWarning: message => this.log.warn('[Mistral] processor: ' + message),
});

// Listen for completed tool calls instead of manually managing
streamProcessor.on('tool_call', (toolCall: XmlToolCall) => {
  const vsCodeId = this.getOrCreateVsCodeToolCallId(toolCall.id ?? `tc-${Date.now()}`);
  const args = toolCall.function?.arguments ?? {};

  progress.report(
    new LanguageModelToolCallPart(
      vsCodeId,
      toolCall.function?.name ?? 'unknown',
      typeof args === 'string' ? { value: args } : (args as Record<string, unknown>),
    ),
  );
});

// Process chunks through processor instead of manually
for await (const streamEvent of mistralStream) {
  if (token.isCancellationRequested) break;

  // Get normalized chunk
  const normalized = normalizeStreamEvent(streamEvent); // ← See 2.2
  if (!normalized) continue;

  // Process through coordinator
  const output = streamProcessor.process(normalized);

  // Text already handled via processor.on('text', ...)
  // Tool calls handled via processor.on('tool_call', ...)
  // Thinking already handled via processor.on('thinking', ...)

  if (output.done) break;
}

// Ensure all buffered state is emitted
streamProcessor.flush();
```

**Benefits:**

- Reduced code complexity (remove manual buffering)
- Better error handling (processor validates JSON)
- Clearer separation of concerns
- Easier to test (processor is self-contained)

**Files to Modify:**

- `src/provider.ts` (update streaming loop, remove manual buffering)
- `src/provider.test.ts` (test processor integration)

**Implementation Details:**

1. Extract `normalizeStreamEvent()` helper (see section 2.2)
2. Simplify tool call handling to use processor events
3. Remove `toolCallBuffers` and related state

**Testing:**

```typescript
it('should use LLMStreamProcessor for tool call accumulation', async () => {
  const processor = new LLMStreamProcessor({ accumulateNativeToolCalls: true });
  const emittedCalls: XmlToolCall[] = [];

  processor.on('tool_call', call => emittedCalls.push(call));

  // Simulate deltas arriving across chunks
  processor.process({ nativeToolCallDeltas: [{ index: 0, name: 'search', argumentsDelta: '{"q' }] });
  processor.process({ nativeToolCallDeltas: [{ index: 0, argumentsDelta: '":"test"}' }] });
  processor.flush();

  // Verify complete tool call emitted
  expect(emittedCalls).toHaveLength(1);
  expect(emittedCalls[0].function?.name).toBe('search');
});
```

**Estimated Effort:** 4 hours

---

### 2.2 Normalize Mistral Stream Events to llm-stream-parser Format

**Issue:** Mistral SDK emits events in native format; llm-stream-parser expects normalized chunks

**Opportunity:** Create normalizer for Mistral, similar to existing OpenAI/Anthropic normalizers

**Current State:**

```typescript
// Raw Mistral event
interface MistralStreamEvent {
  choices: [
    {
      delta: {
        role?: string;
        content?: string;
        toolCalls?: [
          {
            id: string;
            type: string;
            function: {
              name: string;
              arguments: string;
            };
          },
        ];
      };
      finish_reason?: string;
    },
  ];
}

// Used directly in streaming loop (type mismatch with llm-stream-parser)
```

**Solution:** Create Mistral normalizer module

**File:** `src/mistral-normalizer.ts`

```typescript
import type { StreamChunk } from '@selfagency/llm-stream-parser/processor';
import type { NativeToolCallDelta, FinishReason } from '@selfagency/llm-stream-parser/normalizers';

export interface MistralStreamEvent {
  choices?: Array<{
    delta?: {
      content?: string;
      toolCalls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
}

/**
 * Normalizes a Mistral stream event to llm-stream-parser's canonical StreamChunk format.
 * Handles:
 * - Text content extraction
 * - Tool call delta accumulation
 * - Finish reason mapping
 * - Error handling (returns null on malformed input)
 */
export function normalizeMistralStreamEvent(raw: unknown): StreamChunk | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const event = raw as MistralStreamEvent;
  if (!Array.isArray(event.choices)) return null;

  const choice = event.choices[0];
  if (!choice || typeof choice !== 'object') return null;

  const delta = choice.delta;
  if (!delta || typeof delta !== 'object') return null;

  // Extract content
  const content = typeof delta.content === 'string' ? delta.content : undefined;

  // Extract tool call deltas
  let nativeToolCallDeltas: NativeToolCallDelta[] | undefined;
  if (Array.isArray(delta.toolCalls)) {
    const mapped = delta.toolCalls.flatMap((tc, index) => {
      if (!tc || typeof tc !== 'object') return [];

      const fn = tc.function;
      if (!fn || typeof fn !== 'object') return [];

      const name = typeof fn.name === 'string' ? fn.name : undefined;
      const args = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments);

      if (!name || !args) return [];

      return [
        {
          id: typeof tc.id === 'string' ? tc.id : undefined,
          index: typeof tc.id === 'string' ? index : undefined,
          name,
          argumentsDelta: args,
        },
      ];
    });

    if (mapped.length > 0) {
      nativeToolCallDeltas = mapped;
    }
  }

  // Determine if done and finish reason
  const finishReason = mapFinishReason(choice.finish_reason);
  const done = finishReason !== undefined;

  // Build normalized chunk
  const chunk: StreamChunk = {
    ...(content !== undefined && { content }),
    ...(nativeToolCallDeltas !== undefined && { nativeToolCallDeltas }),
    ...(done && { done: true }),
    ...(finishReason !== undefined && { finishReason }),
  };

  return Object.keys(chunk).length > 0 ? chunk : null;
}

function mapFinishReason(mistralReason: string | undefined): FinishReason | undefined {
  if (mistralReason === 'stop') return 'stop';
  if (mistralReason === 'tool_calls') return 'tool_calls';
  if (mistralReason === 'length') return 'length';
  if (mistralReason === 'error') return 'error';
  return undefined;
}

/**
 * Extracts usage information from a final Mistral stream event.
 * Mistral includes usage only on the final chunk (finish_reason !== undefined).
 */
export function extractUsageFromMistralEvent(
  raw: unknown,
): { inputTokens?: number; outputTokens?: number } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;

  const event = raw as any;
  const usage = event.usage;

  if (!usage || typeof usage !== 'object') return undefined;

  const result: { inputTokens?: number; outputTokens?: number } = {};

  if (typeof usage.prompt_tokens === 'number') {
    result.inputTokens = usage.prompt_tokens;
  }
  if (typeof usage.completion_tokens === 'number') {
    result.outputTokens = usage.completion_tokens;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
```

**Update `src/provider.ts` to use normalizer:**

```typescript
import { normalizeMistralStreamEvent, extractUsageFromMistralEvent } from './mistral-normalizer.js';

// In provideLanguageModelChatResponse():
for await (const streamEvent of stream) {
  if (token.isCancellationRequested) break;

  // 1. Normalize Mistral event to canonical format
  const normalized = normalizeMistralStreamEvent(streamEvent);
  if (!normalized) continue;

  // 2. Process through LLMStreamProcessor
  const output = streamProcessor.process(normalized);

  // 3. Extract usage from raw event (processor doesn't do this)
  if (normalized.done) {
    const usage = extractUsageFromMistralEvent(streamEvent);
    if (usage) {
      // Track usage for final reporting
    }
  }
}
```

**Files to Create/Modify:**

- `src/mistral-normalizer.ts` (new file)
- `src/provider.ts` (use normalizer)
- `src/provider.test.ts` (test normalizer)

**Testing:**

```typescript
// src/mistral-normalizer.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeMistralStreamEvent, extractUsageFromMistralEvent } from './mistral-normalizer';

describe('Mistral Normalizer', () => {
  it('should normalize text content', () => {
    const event = {
      choices: [
        {
          delta: { content: 'hello' },
        },
      ],
    };
    const result = normalizeMistralStreamEvent(event);
    expect(result?.content).toBe('hello');
  });

  it('should normalize tool call deltas', () => {
    const event = {
      choices: [
        {
          delta: {
            toolCalls: [
              {
                id: 'tc1',
                function: { name: 'search', arguments: '{"q":"test"}' },
              },
            ],
          },
        },
      ],
    };
    const result = normalizeMistralStreamEvent(event);
    expect(result?.nativeToolCallDeltas).toHaveLength(1);
    expect(result?.nativeToolCallDeltas?.[0].name).toBe('search');
  });

  it('should extract usage on finish', () => {
    const event = {
      choices: [
        {
          delta: {},
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
      },
    };
    const usage = extractUsageFromMistralEvent(event);
    expect(usage?.inputTokens).toBe(100);
    expect(usage?.outputTokens).toBe(50);
  });
});
```

**Estimated Effort:** 3 hours (includes tests)

---

### 2.3 Export Usage Information to VS Code

**Issue:** Token usage is available but never reported to VS Code (matching opilot gap)

**Current State:**

```typescript
// Usage data from Mistral is not used
let usage: { inputTokens?: number; outputTokens?: number } | undefined;
// ... but never reported to stream
```

**Fix:**

```typescript
// Track usage throughout stream
let totalUsage: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 };

for await (const streamEvent of mistralStream) {
  if (token.isCancellationRequested) break;

  // Process events
  const output = streamProcessor.process(normalized);

  // Track usage
  if (normalized.usage) {
    if (normalized.usage.inputTokens !== undefined) {
      totalUsage.inputTokens = normalized.usage.inputTokens;
    }
    if (normalized.usage.outputTokens !== undefined) {
      totalUsage.outputTokens = normalized.usage.outputTokens;
    }
  }
}

// Report final usage to VS Code
if (totalUsage.inputTokens > 0 || totalUsage.outputTokens > 0) {
  progress.report(new LanguageModelTokenCountUsage(totalUsage.inputTokens, totalUsage.outputTokens));
}
```

**Note:** VS Code's API may use different types depending on version. Check `LanguageModelTokenCountUsage` vs direct object reporting.

**Files to Modify:**

- `src/provider.ts` (track and report usage)
- `src/provider.test.ts` (verify usage reporting)

**Estimated Effort:** 1 hour

---

### 2.4 Add Structured Output Validation

**Issue:** Tool call arguments are parsed but not validated against schema

**Opportunity:** Use llm-stream-parser's `parseJson()` utility for schema validation

**Enhancement:**

```typescript
import { parseJson, buildFormatInstructions } from '@selfagency/llm-stream-parser/structured';

// When emitting tool call, validate arguments against tool definition
streamProcessor.on('tool_call', (toolCall: XmlToolCall) => {
  const toolDef = options.tools?.find(t => t.name === toolCall.function?.name);
  if (!toolDef) {
    this.log.warn(`[Mistral] Unknown tool: ${toolCall.function?.name}`);
    return;
  }

  const args = toolCall.function?.arguments ?? {};

  // Optionally validate schema if available (advanced feature)
  if (toolDef.inputSchema) {
    try {
      // Could add schema validation here if needed
      // For now, just ensure it's an object
      if (typeof args !== 'object') {
        this.log.warn(`[Mistral] Tool arguments not object: ${toolCall.function?.name}`);
        return;
      }
    } catch (err) {
      this.log.warn(`[Mistral] Invalid tool arguments: ${String(err)}`);
      return;
    }
  }

  // Emit to VS Code
  const vsCodeId = this.getOrCreateVsCodeToolCallId(toolCall.id ?? `tc-${Date.now()}`);
  progress.report(
    new LanguageModelToolCallPart(vsCodeId, toolCall.function?.name ?? 'unknown', args as Record<string, unknown>),
  );
});
```

**Note:** Full schema validation requires Zod integration, which may be overkill for MVP. Document this as potential future enhancement.

**Estimated Effort:** 1 hour (basic validation only)

---

### Phase 2 Summary

| Task                                         | Effort      | Impact                            |
| -------------------------------------------- | ----------- | --------------------------------- |
| Use LLMStreamProcessor for tool accumulation | 4h          | High (simplifies code)            |
| Create Mistral normalizer                    | 3h          | High (unlocks processor features) |
| Export usage information                     | 1h          | High (exposes token counts)       |
| Structured output validation                 | 1h          | Medium (nice-to-have)             |
| **Phase 2 Total**                            | **9 hours** | **Major refactor**                |

**Deliverable:** v1.2.0 with llm-stream-parser best practices integrated

---

## Phase 3: Testing & Error Scenarios (Week 3)

**Goal:** Comprehensive test suite covering edge cases, error paths, and integration scenarios

**Duration:** 25 hours

### 3.1 Expand Streaming Tests

**Current Gap:** No tests for actual streaming response handling

**New Test Suite:**

**File:** `src/provider.streaming.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MistralChatModelProvider } from './provider';
import * as vscode from 'vscode';

describe('MistralChatModelProvider - Streaming', () => {
  let provider: MistralChatModelProvider;
  let mockProgress: any;
  let token: vscode.CancellationToken;

  beforeEach(() => {
    provider = createMockProvider();
    mockProgress = createMockProgress();
    token = createMockCancellationToken();
  });

  describe('Text Content', () => {
    it('should buffer and emit text chunks', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Hello ' } }] },
        { choices: [{ delta: { content: 'world' } }] },
      ];

      const emittedText: string[] = [];
      mockProgress.report.mockImplementation((part: any) => {
        if (part instanceof vscode.LanguageModelTextPart) {
          emittedText.push(part.value);
        }
      });

      // Simulate streaming
      await provider.simulateStream(chunks, mockProgress, token);

      expect(emittedText).toEqual(['Hello ', 'world']);
    });

    it('should strip privacy tags from content', async () => {
      const chunks = [
        {
          choices: [{
            delta: {
              content: 'Code: <context-snippet>secret-data</context-snippet>public',
            },
          }],
        },
      ];

      const emittedText: string[] = [];
      mockProgress.report.mockImplementation((part: any) => {
        if (part instanceof vscode.LanguageModelTextPart) {
          emittedText.push(part.value);
        }
      });

      await provider.simulateStream(chunks, mockProgress, token);

      expect(emittedText[0]).toContain('public');
      expect(emittedText[0]).not.toContain('secret-data');
    });
  });

  describe('Tool Calls', () => {
    it('should accumulate tool call arguments across chunks', async () => {
      const chunks = [
        {
          choices: [{
            delta: {
              toolCalls: [{
                id: 'tc1',
                function: {
                  name: 'search',
                  arguments: '{"q":"',
                },
              }],
            },
          }],
        },
        {
          choices: [{
            delta: {
              toolCalls: [{
                id: 'tc1',
                function: {
                  arguments: 'hello"}',
                },
              }],
            },
          }],
        },
      ];

      const emittedCalls: any[] = [];
      mockProgress.report.mockImplementation((part: any) => {
        if (part instanceof vscode.LanguageModelToolCallPart) {
          emittedCalls.push(part);
        }
      });

      await provider.simulateStream(chunks, mockProgress, token);

      expect(emittedCalls).toHaveLength(1);
      expect(emittedCalls[0].name).toBe('search');
      expect(emittedCalls[0].arguments.q).toBe('hello');
    });

    it('should handle multiple tool calls', async () => {
      // ...
    });

    it('should skip invalid tool call arguments', async () => {
      const chunks = [
        {
          choices: [{
            delta: {
              toolCalls: [{
                id: 'tc1',
                function: {
                  name: 'search',
                  arguments: '{invalid json}',
                },
              }],
            },
          }],
        },
      ];

      const emittedCalls: any[] = [];
      const emittedText: any[] = [];

      mockProgress.report.mockImplementation((part: any) => {
        if (part instanceof vscode.LanguageModelToolCallPart) {
          emittedCalls.push(part);
        } else if (part instanceof vscode.LanguageModelTextPart) {
          emittedText.push(part);
        }
      });

      await provider.simulateStream(chunks, mockProgress, token);

      expect(emittedCalls).toHaveLength(0); // No valid tool call
      expect(emittedText.some(t => t.value.includes('invalid'))).toBe(true); // Error reported
    });
  });

  describe('Thinking Content', () => {
    it('should extract and log thinking tags', async () => {
      const chunks = [
        {
          choices: [{
            delta: {
              content: '<brainstorm>Let me think... 1+1=2</brainstorm>The answer is 2',
            },
          }],
        },
      ];

      const emittedText: string[] = [];
      const logs: string[] = [];

      mockProgress.report.mockImplementation((part: any) => {
        if (part instanceof vscode.LanguageModelTextPart) {
          emittedText.push(part.value);
        }
      });

      provider.log = { debug: (msg: string) => logs.push(msg) };

      await provider.simulateStream(chunks, mockProgress, token);

      // Thinking should be logged, not shown
      expect(logs.some(l => l.includes('thinking'))).toBe(true);
      // But not in emitted text
      expect(emittedText.join('').includes('brainstorm')).toBe(false);
    });
  });

  describe('Cancellation', () => {
    it('should stop streaming on cancellation', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Start' } }] },
        // Second chunk should not be processed
        { choices: [{ delta: { content: 'End' } }] },
      ];

      const emittedText: string[] = [];
      mockProgress.report.mockImplementation((part: any) => {
        if (part instanceof vscode.LanguageModelTextPart) {
          emittedText.push(part.value);
        }
      });

      // Mock cancellation after first chunk
      token.isCancellationRequested = true;

      await provider.simulateStream(chunks, mockProgress, token);

      expect(emittedText).toEqual(['Start']);
      expect(emittedText).not.toContain('End');
    });
  });

  describe('Usage Tracking', () => {
    it('should report token usage on stream end', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Response' } }] },
        {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        },
      ];

      const reportedUsage: any[] = [];
      mockProgress.report.mockImplementation((part: any) => {
        if (part instanceof vscode.LanguageModelTokenCountUsage) {
          reportedUsage.push(part);
        }
      });

      await provider.simulateStream(chunks, mockProgress, token);

      expect(reportedUsage).toHaveLength(1);
      expect(reportedUsage[0].inputTokens).toBe(10);
      expect(reportedUsage[0].outputTokens).toBe(20);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      mockClient.chat.stream.mockRejectedValueOnce(
        new Error('Network timeout')
      );

      const emittedErrors: string[] = [];
      mockProgress.report.mockImplementation((part: any) => {
        if (part instanceof vscode.LanguageModelTextPart &&
            part.value.includes('Error')) {
          emittedErrors.push(part.value);
        }
      });

      await expect(provider.provideLanguageModelChatResponse(
        { ... },
        mockProgress,
        token,
      )).rejects.toThrow();

      expect(emittedErrors.some(e => e.includes('timeout'))).toBe(true);
    });
  });
});
```

**Estimated Effort:** 6 hours

---

### 3.2 Add Integration Tests

**File:** `test/integration/provider.integration.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MistralChatModelProvider } from '../../src/provider';

describe('Mistral Provider - Integration', () => {
  let provider: MistralChatModelProvider;

  beforeAll(async () => {
    provider = new MistralChatModelProvider(mockContext, { silent: true });

    // Use test API key if available
    const testApiKey = process.env.MISTRAL_API_KEY_TEST;
    if (!testApiKey) {
      console.warn('Skipping integration tests (no MISTRAL_API_KEY_TEST)');
      return;
    }

    await provider.setApiKey(); // Store it
  });

  afterAll(async () => {
    provider.dispose();
  });

  describe('Model List', () => {
    it('should fetch real model list from Mistral', async function () {
      // Skip if no API key
      if (!process.env.MISTRAL_API_KEY_TEST) {
        this.skip();
      }

      const models = await provider.provideLanguageModelChatInformation({ silent: false }, mockCancellationToken);

      expect(models.length).toBeGreaterThan(0);
      expect(models[0].name).toBeDefined();
      expect(models[0].maxInputTokens).toBeGreaterThan(0);
    });
  });

  describe('Chat Request', () => {
    it('should send a real chat request and get response', async function () {
      if (!process.env.MISTRAL_API_KEY_TEST) {
        this.skip();
      }

      const request = {
        model: { id: 'mistral-small-latest', vendor: 'mistral' },
        messages: [vscode.LanguageModelChatMessage.User('What is 2+2?')],
        options: { tools: [] },
        systemPrompt: [],
      };

      const mockProgress = createMockProgress();
      const textParts: string[] = [];

      mockProgress.report.mockImplementation((part: any) => {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part.value);
        }
      });

      await provider.provideLanguageModelChatResponse(request, mockProgress, mockCancellationToken);

      const response = textParts.join('');
      expect(response.length).toBeGreaterThan(0);
      expect(response.toLowerCase()).toContain('4');
    });
  });
});
```

**Note:** Integration tests should be skipped in CI unless `MISTRAL_API_KEY_TEST` is set.

**Estimated Effort:** 3 hours

---

### 3.3 Error Scenario Tests

**File:** `src/provider.errors.test.ts`

```typescript
describe('Error Scenarios', () => {
  describe('Invalid API Key', () => {
    it('should handle 401 Unauthorized error', async () => {
      provider.setApiKey('invalid-key-123');

      const mockProgress = createMockProgress();
      const errors: string[] = [];

      mockProgress.report.mockImplementation((part: any) => {
        if (part instanceof vscode.LanguageModelTextPart && part.value.includes('Error')) {
          errors.push(part.value);
        }
      });

      await expect(
        provider.provideLanguageModelChatResponse(mockRequest, mockProgress, mockCancellationToken),
      ).rejects.toThrow();

      expect(errors.some(e => e.includes('API key'))).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    it('should retry on 429 error', async () => {
      const mockClient = mockProvider().client as any;

      let attempts = 0;
      mockClient.chat.stream.mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw { statusCode: 429, message: 'Rate limited' };
        }
        return createMockStreamGenerator();
      });

      const mockProgress = createMockProgress();

      await provider.provideLanguageModelChatResponse(mockRequest, mockProgress, mockCancellationToken);

      expect(attempts).toBe(2); // Second attempt succeeded
    });
  });

  describe('Model Not Found', () => {
    it('should handle 404 model not found', async () => {
      // ...
    });
  });

  describe('Stream Interruption', () => {
    it('should handle stream closed mid-response', async () => {
      // Simulate stream throwing error midway
      const generator = async function* () {
        yield { choices: [{ delta: { content: 'Start' } }] };
        throw new Error('Stream closed');
      };

      mockClient.chat.stream.mockReturnValue(generator());

      const mockProgress = createMockProgress();
      const textParts: string[] = [];

      mockProgress.report.mockImplementation((part: any) => {
        if (part instanceof vscode.LanguageModelTextPart) {
          textParts.push(part.value);
        }
      });

      await expect(
        provider.provideLanguageModelChatResponse(mockRequest, mockProgress, mockCancellationToken),
      ).rejects.toThrow();

      // Partial response still reported
      expect(textParts).toContain('Start');
    });
  });
});
```

**Estimated Effort:** 4 hours

---

### 3.4 Remove Dead Code & Fix Build Issues

**Issues:**

- M9: Redundant tsup entry point
- L15: Unnecessary xvfb-run
- L8: Duplicate tests
- M10: Unversioned @types/vscode

**Fixes:**

1. **Update `tsup.config.mjs`:**

```javascript
export default {
  entry: ['src/extension.ts'], // Remove src/provider.ts
  format: ['esm'],
  target: 'es2022',
  minify: true,
};
```

1. **Update `.github/workflows/ci.yml`:**

```yaml
- run: npm run test:extension # Remove xvfb-run -a
```

1. **Consolidate duplicate tests in `src/provider.test.ts`:**

- Remove duplicate `getMistralToolCallId` tests
- Keep one comprehensive test

1. **Update `package.json`:**

```json
{
  "devDependencies": {
    "@types/vscode": "1.96.0" // Pin to specific version
  }
}
```

**Estimated Effort:** 1.5 hours

---

### Phase 3 Summary

| Task                   | Effort         | Impact                       |
| ---------------------- | -------------- | ---------------------------- |
| Expand streaming tests | 6h             | High (coverage++)            |
| Integration tests      | 3h             | High (real-world validation) |
| Error scenario tests   | 4h             | High (robustness++)          |
| Remove dead code       | 1.5h           | Medium (cleanup)             |
| **Phase 3 Total**      | **14.5 hours** | **Comprehensive testing**    |

**Deliverable:** v1.3.0 with 85%+ test coverage and error scenarios handled

---

## Phase 4: Polish & Technical Debt (Week 4)

**Goal:** Final improvements, documentation, and release preparation

**Duration:** 25 hours

### 4.1 Documentation & Comments

**Tasks:**

1. **README.md** — Add configuration section:

```markdown
## Configuration

### Per-Model Output Limits

The extension automatically applies correct token limits for each Mistral model:

- `mistral-small`: 4,096 tokens
- `mistral-medium`: 8,192 tokens
- `mistral-large`: 16,384 tokens
- etc.

### Thinking Tag Extraction

Models with extended reasoning capabilities (future Mistral releases) will have their thinking tags extracted and logged for debugging purposes.

### Tool Support

When tools are defined, they are passed to the model. Incomplete tool call arguments are accumulated across chunks and validated before invocation.
```

1. **Code comments** — Add invariant documentation:

```typescript
/**
 * Mistral stream events are normalized to llm-stream-parser's StreamChunk format.
 * This enables us to leverage LLMStreamProcessor for:
 * - Thinking tag extraction (<brainstorm>...</brainstorm>)
 * - Privacy tag scrubbing (<context-snippet>...</context-snippet>)
 * - Tool call delta accumulation (across chunks)
 *
 * Invariants:
 * - Each normalized chunk has at most 1 finish_reason per request
 * - Tool calls may be spread across multiple chunks; id+index identify them
 * - Usage information only appears on chunks with finish_reason !== undefined
 */
```

1. **Architecture diagram** — Update docs/architecture.md with data flow

**Estimated Effort:** 4 hours

---

### 4.2 Performance Optimization

**Tasks:**

1. **Reduce bundle size** — Evaluate `js-tiktoken`:

```typescript
// Option 1: Use lite version
import { encoding_for_model } from 'js-tiktoken/lite';

// Option 2: Character heuristic (fallback)
const estimateTokenCount = (text: string): number => {
  return Math.ceil(text.length / 3.5); // Rough estimate
};
```

1. **Lazy-load tokenizer:**

```typescript
private _tokenizer: JsTiktoken | null = null;

private getTokenizer(): JsTiktoken {
  if (!this._tokenizer) {
    // Only load when first needed
    this._tokenizer = new JsTiktoken(cl100kBase);
  }
  return this._tokenizer;
}

dispose() {
  this._tokenizer = null; // Free memory
}
```

1. **Cache computed values** — Memoize `toMistralRole()`, `getUserFriendlyError()`

**Estimated Effort:** 3 hours

---

### 4.3 Security & Compliance

**Tasks:**

1. **Secret scanning** — Ensure no API keys logged:

```bash
cd mistral-models-vscode
npm audit
git-secrets scan
```

1. **Add .gitignore entries:**

```
# Local testing
.env.local
.env.test
secrets/

# IDE
.vscode/
.idea/
```

1. **Add SECURITY.md:**

```markdown
# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability, please email security@selfagency.com
instead of using the issue tracker.

## Secure Practices

- API keys are stored in VS Code's encrypted secrets storage, never in code or config files
- All HTTP requests use HTTPS
- User inputs are validated before passing to the Mistral API
- Error messages are sanitized before display to prevent info leakage
```

**Estimated Effort:** 2 hours

---

### 4.4 Version Management & Release

**Tasks:**

1. **Update version to 2.0.0:**

```json
{
  "version": "2.0.0",
  "description": "Mistral AI models integration for VS Code Chat — now with llm-stream-parser"
}
```

1. **Create CHANGELOG.md:**

```markdown
# Changelog

## [2.0.0] — 2026-05-03

### ✨ Features

- Full integration with @selfagency/llm-stream-parser (unified stream processing)
- ChatResponseTurn2 support (VS Code 1.96+ compatibility)
- TTL-based model list caching (30-minute refresh)
- User-friendly error messages with recovery suggestions
- Token usage reporting in VS Code Chat

### 🐛 Bug Fixes

- Fix per-model token limits (was 4096 for all)
- Fix missing event fire on API key change
- Fix tool call arguments validation and error handling
- Fix Dependabot configuration (was broken)
- Fix abortController signal passing to Mistral SDK

### ♻️ Refactoring

- Migrate to normalizer-based stream processing (matches llm-stream-parser v0.1.5+)
- Simplify tool call buffering via LLMStreamProcessor
- Extract Mistral normalizer module for reusability
- Remove redundant tsup entry point

### 📊 Testing

- Add 50+ new tests (85% coverage)
- Add streaming scenario tests (accumulation, cancellation, errors)
- Add integration tests (real API calls with test key)
- Add error scenario tests (rate limiting, invalid models, etc.)

### 📚 Documentation

- Document per-model token limits
- Document thinking tag extraction behavior
- Add architecture diagram
- Add security policy

### 🔧 Maintenance

- Upgrade @types/vscode to v1.96.0 (pinned)
- Remove unnecessary xvfb-run from CI
- Add .vscodeignore exclusions
- Clean up dead code and duplicate tests
```

1. **Create release PR:**

```
Title: Release v2.0.0: LLM Stream Parser Integration & Bug Fixes

Body:
This release brings full integration with llm-stream-parser v0.1.5, resolving
5 critical and 15 important issues identified in the code review.

**Major Changes:**
- Normalized stream processing via llm-stream-parser
- ChatResponseTurn2 support (VS Code 1.96+ compat)
- Fixed per-model token limits
- Full error handling and user-friendly messages
- 85%+ test coverage

Fixes: #123, #456, ...

See CHANGELOG.md for full details.
```

**Estimated Effort:** 3 hours

---

### 4.5 Dependency Updates & Security Audit

**Tasks:**

1. **Update dependencies:**

```bash
npm outdated  # Check for updates
npm update --save  # Update minor/patch
```

1. **Run security audit:**

```bash
npm audit  # Check for vulnerabilities
npm audit fix  # Auto-fix where possible
```

1. **Pin critical versions:**

```json
{
  "dependencies": {
    "@selfagency/llm-stream-parser": "0.1.5", // Exact version (pre-release)
    "mistral-common": "0.4.0",
    "mistral-inference": "0.4.0"
  },
  "devDependencies": {
    "@types/vscode": "1.96.0",
    "vitest": "2.0.5"
  }
}
```

**Estimated Effort:** 1.5 hours

---

### 4.6 Final Testing & QA

**Tasks:**

1. **Manual QA checklist:**

- [ ] Test with mistral-small, medium, large models
- [ ] Test tool calling (if available)
- [ ] Test cancellation during long request
- [ ] Test API key change and model list refresh
- [ ] Test with expired API key (error message)
- [ ] Test with no internet connection
- [ ] Verify token counts display in UI
- [ ] Check extension size (VSIX file)

1. **Performance profiling:**

```bash
# Check memory usage during long streaming response
# Check CPU usage during model list fetch
# Check bundle size
```

1. **Accessibility check:**

- [ ] Error messages are readable
- [ ] Tool calls are properly announced
- [ ] Keyboard navigation works

**Estimated Effort:** 3 hours

---

### 4.7 Extension Publishing

**Tasks:**

1. **Create VSIX package:**

```bash
npm run package  # Build dist and create VSIX
```

1. **Publish to VS Code Marketplace:**

```bash
vsce publish  # Requires personal access token
```

1. **Create GitHub release:**

```bash
gh release create v2.0.0 --generate-notes
```

**Estimated Effort:** 1 hour

---

### Phase 4 Summary

| Task                     | Effort         | Impact                 |
| ------------------------ | -------------- | ---------------------- |
| Documentation            | 4h             | High (maintainability) |
| Performance optimization | 3h             | Medium (bundle size)   |
| Security & compliance    | 2h             | High (safety)          |
| Release management       | 3h             | High (professionalism) |
| Dependency updates       | 1.5h           | High (security)        |
| Final QA                 | 3h             | High (confidence)      |
| Publishing               | 1h             | High (availability)    |
| **Phase 4 Total**        | **17.5 hours** | **Production release** |

**Deliverable:** v2.0.0 released to VS Code Marketplace with full documentation and zero known issues

---

## Timeline & Milestones

| Week           | Phase                           | Duration      | Milestone                           | Status                        |
| -------------- | ------------------------------- | ------------- | ----------------------------------- | ----------------------------- |
| **Pre-Week 1** | Phase 0: Dependency Audit       | ~8h           | Upgrade to latest llm-stream-parser | Blocks Phase 2                |
| **Week 1**     | Phase 1: Critical Fixes         | ~8h           | v1.1.0 Beta                         | Fixes 4-5 critical issues     |
| **Week 2**     | Phase 2: LLM Parser Integration | ~9h           | v1.2.0 Beta                         | Refactor stream processing    |
| **Week 3**     | Phase 3: Testing                | ~14.5h        | v1.3.0 Release                      | 85% coverage, error scenarios |
| **Week 4**     | Phase 4: Polish & Release       | ~17.5h        | **v2.0.0 GA**                       | Production release            |
| **Total**      | **All Phases**                  | **~57 hours** | **Production-ready**                | **Complete**                  |

---

## Risk Mitigation

| Risk                                 | Probability | Impact | Mitigation                                               |
| ------------------------------------ | ----------- | ------ | -------------------------------------------------------- |
| Breaking change in llm-stream-parser | Low         | High   | Pin version, add integration tests                       |
| Mistral API changes                  | Low         | Medium | Use versioned API endpoints, add defensive parsing       |
| VS Code API incompatibility          | Low         | Medium | Test on multiple VS Code versions, use version detection |
| Performance regression               | Low         | Medium | Add performance benchmarks to CI                         |
| User adoption                        | Medium      | Low    | Clear migration guide for v1.x users                     |

---

## Success Criteria

- ✅ All 40+ identified issues fixed or documented
- ✅ 85%+ test coverage with streaming scenarios
- ✅ Zero critical bugs in v2.0.0 release
- ✅ Full llm-stream-parser integration (normalized events, processor usage)
- ✅ ChatResponseTurn2 support verified
- ✅ Token usage reporting works
- ✅ Error messages are user-friendly
- ✅ Extension published to VS Code Marketplace
- ✅ Documentation complete and accurate
- ✅ Security audit passed with zero vulnerabilities

---

## Appendix: Code Checklists

### Pre-Phase 0 Checklist (Dependency Audit)

- [ ] Check latest version: `npm view @selfagency/llm-stream-parser dist-tags`
- [ ] Review CHANGELOG for breaking changes
- [ ] Create migration guide if needed
- [ ] Create test branch: `test/llm-stream-parser-upgrade`
- [ ] Run full test suite with new version
- [ ] Verify type compatibility with `tsc --noEmit`
- [ ] Merge upgrade if tests pass

### Pre-Phase 1 Checklist

- [ ] Phase 0 upgrade complete and merged
- [ ] Create feature branch: `feature/critical-fixes-v1.1`
- [ ] Create GitHub issues for each bug (H1-H5)
- [ ] Set up CI monitoring (GitHub Actions)
- [ ] Assign team members

### Pre-Phase 2 Checklist

- [ ] Phase 1 critical fixes merged to main
- [ ] Verify llm-stream-parser is at latest version (from Phase 0)
- [ ] Review llm-stream-parser API docs for processor features
- [ ] Create normalizer module template based on existing normalizers
- [ ] Create feature branch: `feature/stream-parser-optimization`

### Pre-Phase 3 Checklist

- [ ] Phase 2 refactoring merged to main
- [ ] Set up `MISTRAL_API_KEY_TEST` for integration tests
- [ ] Create test utilities and mock factories
- [ ] Document test running instructions

### Pre-Phase 4 Checklist

- [ ] Phase 3 tests merged to main
- [ ] Prepare CHANGELOG entries
- [ ] Review security policies
- [ ] Set up Marketplace publishing workflow

---

## Estimated Resource Requirements

| Role                   | Hours            | Notes                                                 |
| ---------------------- | ---------------- | ----------------------------------------------------- |
| **Senior Engineer**    | 40               | Design, refactoring, dependency audit, critical fixes |
| **Mid-level Engineer** | 15               | Tests, documentation, polish                          |
| **QA**                 | 10               | Manual testing, integration validation                |
| **Product/Docs**       | 5                | Release notes, documentation                          |
| **Total**              | **70 FTE-hours** | ~2.5 weeks of 1 full-time engineer                    |

---

**Document Status:** Draft - Ready for Review & Approval
**Last Updated:** May 3, 2026
**Owner:** @selfagency/llm-stream-parser Team
