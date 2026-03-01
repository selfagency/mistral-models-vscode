# Unit Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose internal functions/methods in `provider.ts` and `extension.ts`, then add comprehensive vitest unit tests covering all exposed logic.

**Architecture:** Add `export` to three module-level functions, change six private class methods to public, create a shared VS Code stub module that vitest resolves in place of the real `vscode` package via an alias, then write tests in two files.

**Tech Stack:** vitest ^4 (already installed), TypeScript Node16 module mode, esbuild transform via vitest defaults.

---

### Task 1: Vitest config

**Files:**
- Create: `vitest.config.ts`

**Step 1: Create the config**

```typescript
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'src/test/vscode.mock.ts'),
    },
  },
  test: {
    environment: 'node',
  },
})
```

The `alias` replaces every `import ... from 'vscode'` with the stub — no `vi.mock()` calls needed in test files.

**Step 2: Verify vitest can run (no tests yet)**

```bash
pnpm vitest run
```

Expected: exits with "No test files found" or similar (not an error crash).

**Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "test: add vitest config with vscode module alias"
```

---

### Task 2: VS Code stub module

**Files:**
- Create: `src/test/vscode.mock.ts`

**Step 1: Create the stub**

```typescript
import { vi } from 'vitest'

export enum LanguageModelChatMessageRole {
  User = 1,
  Assistant = 2,
}

export enum LanguageModelChatToolMode {
  Auto = 0,
  Required = 1,
}

export enum InputBoxValidationSeverity {
  Info = 1,
  Warning = 2,
  Error = 3,
}

export class LanguageModelTextPart {
  constructor(public readonly value: string) {}
}

export class LanguageModelToolCallPart {
  constructor(
    public readonly callId: string,
    public readonly name: string,
    public readonly input: Record<string, unknown>,
  ) {}
}

export class LanguageModelToolResultPart {
  constructor(
    public readonly callId: string,
    public readonly content: LanguageModelTextPart[],
  ) {}
}

export class LanguageModelDataPart {
  constructor(
    public readonly data: Uint8Array,
    public readonly mimeType: string,
  ) {}
}

export const window = {
  showInputBox: vi.fn(),
}

export const lm = {
  registerLanguageModelChatProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
}

export const commands = {
  registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
}
```

**Step 2: Commit**

```bash
git add src/test/vscode.mock.ts
git commit -m "test: add VS Code stub module for vitest"
```

---

### Task 3: Export standalone functions and types

**Files:**
- Modify: `src/provider.ts`
- Create: `src/provider.test.ts`

**Step 1: Write the failing tests first**

Create `src/provider.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  LanguageModelChatMessageRole,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  LanguageModelDataPart,
} from 'vscode'
import {
  formatModelName,
  getChatModelInfo,
  toMistralRole,
  MistralChatModelProvider,
} from './provider'

// ── Shared mock context ───────────────────────────────────────────────────────

const mockContext = {
  secrets: {
    get: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    onDidChange: vi.fn(),
  },
  subscriptions: [],
} as any

// ── formatModelName ───────────────────────────────────────────────────────────

describe('formatModelName', () => {
  it('capitalises a single segment', () => {
    expect(formatModelName('mistral')).toBe('Mistral')
  })

  it('capitalises each hyphen-separated segment', () => {
    expect(formatModelName('mistral-large-latest')).toBe('Mistral Large Latest')
  })

  it('handles numeric segments without error', () => {
    expect(formatModelName('devstral-small-2505')).toBe('Devstral Small 2505')
  })
})
```

**Step 2: Run — expect import error**

```bash
pnpm vitest run src/provider.test.ts
```

Expected: fails with "does not provide an export named 'formatModelName'" (or similar).

**Step 3: Export the three functions and two types in `provider.ts`**

In `src/provider.ts`, add `export` to each:

```typescript
// line 25 — interface
export interface MistralModel { ... }

// line 77 — type
export type MistralContent = ...

// line 79 — type
export type MistralToolCall = ...

// line 88 — type
export type MistralMessage = ...

// line 47 — function
export function formatModelName(id: string): string { ... }

// line 57 — function
export function getChatModelInfo(model: MistralModel): LanguageModelChatInformation { ... }

// line 614 — function
export function toMistralRole(role: LanguageModelChatMessageRole): 'user' | 'assistant' { ... }
```

**Step 4: Run — expect PASS for formatModelName tests**

```bash
pnpm vitest run src/provider.test.ts
```

Expected: 3 tests pass.

**Step 5: Commit**

```bash
git add src/provider.ts src/provider.test.ts
git commit -m "test: export standalone functions and add formatModelName tests"
```

---

### Task 4: Tests for getChatModelInfo and toMistralRole

**Files:**
- Modify: `src/provider.test.ts`

**Step 1: Append tests to `src/provider.test.ts`**

```typescript
// ── getChatModelInfo ──────────────────────────────────────────────────────────

describe('getChatModelInfo', () => {
  const base = {
    id: 'mistral-large-latest',
    name: 'Mistral Large',
    maxInputTokens: 128000,
    maxOutputTokens: 16384,
    defaultCompletionTokens: 65536,
    toolCalling: true,
    supportsParallelToolCalls: true,
    supportsVision: true,
  }

  it('maps all fields correctly', () => {
    const info = getChatModelInfo(base)
    expect(info.id).toBe('mistral-large-latest')
    expect(info.name).toBe('Mistral Large')
    expect(info.family).toBe('mistral')
    expect(info.maxInputTokens).toBe(128000)
    expect(info.maxOutputTokens).toBe(16384)
    expect(info.capabilities?.toolCalling).toBe(true)
    expect(info.capabilities?.imageInput).toBe(true)
  })

  it('tooltip includes detail when present', () => {
    const info = getChatModelInfo({ ...base, detail: 'Latest flagship' })
    expect(info.tooltip).toBe('Mistral Mistral Large - Latest flagship')
  })

  it('tooltip omits detail when absent', () => {
    const info = getChatModelInfo(base)
    expect(info.tooltip).toBe('Mistral Mistral Large')
  })

  it('imageInput is false when supportsVision is false', () => {
    const info = getChatModelInfo({ ...base, supportsVision: false })
    expect(info.capabilities?.imageInput).toBe(false)
  })

  it('imageInput is false when supportsVision is undefined', () => {
    const { supportsVision: _, ...noVision } = base
    const info = getChatModelInfo(noVision as any)
    expect(info.capabilities?.imageInput).toBe(false)
  })
})

// ── toMistralRole ─────────────────────────────────────────────────────────────

describe('toMistralRole', () => {
  it('maps User to "user"', () => {
    expect(toMistralRole(LanguageModelChatMessageRole.User)).toBe('user')
  })

  it('maps Assistant to "assistant"', () => {
    expect(toMistralRole(LanguageModelChatMessageRole.Assistant)).toBe('assistant')
  })

  it('maps unknown values to "user"', () => {
    expect(toMistralRole(99 as any)).toBe('user')
  })
})
```

**Step 2: Run — expect all new tests to pass**

```bash
pnpm vitest run src/provider.test.ts
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add src/provider.test.ts
git commit -m "test: add getChatModelInfo and toMistralRole tests"
```

---

### Task 5: Make tool call ID methods public + tests

**Files:**
- Modify: `src/provider.ts`
- Modify: `src/provider.test.ts`

**Step 1: Append tests to `src/provider.test.ts`**

```typescript
// ── Tool call ID mapping ──────────────────────────────────────────────────────

describe('MistralChatModelProvider — tool call ID mapping', () => {
  let provider: MistralChatModelProvider

  beforeEach(() => {
    provider = new MistralChatModelProvider(mockContext)
  })

  describe('generateToolCallId', () => {
    it('returns a 9-character string', () => {
      expect(provider.generateToolCallId()).toHaveLength(9)
    })

    it('returns only alphanumeric characters', () => {
      const id = provider.generateToolCallId()
      expect(id).toMatch(/^[a-zA-Z0-9]{9}$/)
    })

    it('produces unique IDs across calls', () => {
      const ids = new Set(Array.from({ length: 20 }, () => provider.generateToolCallId()))
      expect(ids.size).toBeGreaterThan(1)
    })
  })

  describe('getOrCreateVsCodeToolCallId', () => {
    it('returns a 9-character alphanumeric ID for a new Mistral ID', () => {
      const id = provider.getOrCreateVsCodeToolCallId('mistral-abc')
      expect(id).toMatch(/^[a-zA-Z0-9]{9}$/)
    })

    it('returns the same VS Code ID for the same Mistral ID (idempotent)', () => {
      const first = provider.getOrCreateVsCodeToolCallId('mistral-abc')
      const second = provider.getOrCreateVsCodeToolCallId('mistral-abc')
      expect(first).toBe(second)
    })

    it('creates distinct VS Code IDs for different Mistral IDs', () => {
      const a = provider.getOrCreateVsCodeToolCallId('mistral-aaa')
      const b = provider.getOrCreateVsCodeToolCallId('mistral-bbb')
      expect(a).not.toBe(b)
    })

    it('registers the bidirectional mapping so getMistralToolCallId resolves back', () => {
      const vsCodeId = provider.getOrCreateVsCodeToolCallId('mistral-xyz')
      expect(provider.getMistralToolCallId(vsCodeId)).toBe('mistral-xyz')
    })
  })

  describe('getMistralToolCallId', () => {
    it('returns the Mistral ID for a known VS Code ID', () => {
      const vsCodeId = provider.getOrCreateVsCodeToolCallId('mistral-known')
      expect(provider.getMistralToolCallId(vsCodeId)).toBe('mistral-known')
    })

    it('returns undefined for an unknown VS Code ID', () => {
      expect(provider.getMistralToolCallId('unknown-id')).toBeUndefined()
    })
  })

  describe('clearToolCallIdMappings', () => {
    it('makes previously mapped IDs no longer resolvable', () => {
      const vsCodeId = provider.getOrCreateVsCodeToolCallId('mistral-to-clear')
      provider.clearToolCallIdMappings()
      expect(provider.getMistralToolCallId(vsCodeId)).toBeUndefined()
    })

    it('subsequent getOrCreate after clear creates a fresh (possibly different) ID', () => {
      const before = provider.getOrCreateVsCodeToolCallId('mistral-refresh')
      provider.clearToolCallIdMappings()
      const after = provider.getOrCreateVsCodeToolCallId('mistral-refresh')
      // Both are valid IDs; they may differ due to randomness
      expect(after).toMatch(/^[a-zA-Z0-9]{9}$/)
      // The old mapping is gone
      expect(provider.getMistralToolCallId(before)).toBeUndefined()
    })
  })
})
```

**Step 2: Run — expect access errors on private methods**

```bash
pnpm vitest run src/provider.test.ts
```

Expected: TypeScript errors or runtime failures on `provider.generateToolCallId`, etc.

**Step 3: Change four private methods to public in `src/provider.ts`**

Change `private` → `public` for:
- `generateToolCallId()` (line ~111)
- `getOrCreateVsCodeToolCallId(mistralId: string)` (line ~123)
- `getMistralToolCallId(vsCodeId: string)` (line ~138)
- `clearToolCallIdMappings()` (line ~181)

**Step 4: Run — expect all tests to pass**

```bash
pnpm vitest run src/provider.test.ts
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/provider.ts src/provider.test.ts
git commit -m "test: expose and test tool call ID mapping methods"
```

---

### Task 6: fetchModels tests

**Files:**
- Modify: `src/provider.ts`
- Modify: `src/provider.test.ts`

**Step 1: Append tests**

```typescript
// ── fetchModels ───────────────────────────────────────────────────────────────

describe('MistralChatModelProvider — fetchModels', () => {
  let provider: MistralChatModelProvider

  const chatModel = {
    id: 'mistral-large-latest',
    name: 'Mistral Large',
    description: 'Flagship model',
    maxContextLength: 128000,
    defaultModelTemperature: 0.7,
    capabilities: { completionChat: true, functionCalling: true, vision: true },
  }

  const embedModel = {
    id: 'mistral-embed',
    name: null,
    description: null,
    maxContextLength: 8192,
    defaultModelTemperature: null,
    capabilities: { completionChat: false, functionCalling: false, vision: false },
  }

  beforeEach(() => {
    provider = new MistralChatModelProvider(mockContext)
  })

  it('returns empty array when no client is set', async () => {
    const models = await provider.fetchModels()
    expect(models).toEqual([])
  })

  it('filters out models without completionChat capability', async () => {
    const mockList = vi.fn().mockResolvedValue({ data: [chatModel, embedModel] })
    ;(provider as any).client = { models: { list: mockList } }

    const models = await provider.fetchModels()
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('mistral-large-latest')
  })

  it('maps API fields to MistralModel correctly', async () => {
    const mockList = vi.fn().mockResolvedValue({ data: [chatModel] })
    ;(provider as any).client = { models: { list: mockList } }

    const [model] = await provider.fetchModels()
    expect(model.name).toBe('Mistral Large')
    expect(model.detail).toBe('Flagship model')
    expect(model.maxInputTokens).toBe(128000)
    expect(model.toolCalling).toBe(true)
    expect(model.supportsParallelToolCalls).toBe(true)
    expect(model.supportsVision).toBe(true)
    expect(model.temperature).toBe(0.7)
  })

  it('falls back to formatModelName when name is null', async () => {
    const noName = { ...chatModel, name: null }
    const mockList = vi.fn().mockResolvedValue({ data: [noName] })
    ;(provider as any).client = { models: { list: mockList } }

    const [model] = await provider.fetchModels()
    expect(model.name).toBe('Mistral Large Latest')
  })

  it('caches the result — second call does not hit the API', async () => {
    const mockList = vi.fn().mockResolvedValue({ data: [chatModel] })
    ;(provider as any).client = { models: { list: mockList } }

    await provider.fetchModels()
    await provider.fetchModels()
    expect(mockList).toHaveBeenCalledTimes(1)
  })

  it('returns empty array and does not throw on API error', async () => {
    const mockList = vi.fn().mockRejectedValue(new Error('network error'))
    ;(provider as any).client = { models: { list: mockList } }

    const models = await provider.fetchModels()
    expect(models).toEqual([])
  })

  it('cache is cleared after setApiKey is called', async () => {
    // Prime the cache
    const mockList = vi.fn().mockResolvedValue({ data: [chatModel] })
    ;(provider as any).client = { models: { list: mockList } }
    await provider.fetchModels()

    // Simulate key change (resets fetchedModels)
    ;(provider as any).fetchedModels = null
    ;(provider as any).client = { models: { list: mockList } }

    await provider.fetchModels()
    expect(mockList).toHaveBeenCalledTimes(2)
  })
})
```

**Step 2: Run — expect private access failure**

```bash
pnpm vitest run src/provider.test.ts
```

Expected: TypeScript/runtime error on `provider.fetchModels`.

**Step 3: Change `fetchModels` to public in `src/provider.ts`**

Line ~146: `private async fetchModels()` → `public async fetchModels()`

**Step 4: Run — expect all tests to pass**

```bash
pnpm vitest run src/provider.test.ts
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/provider.ts src/provider.test.ts
git commit -m "test: expose and test fetchModels"
```

---

### Task 7: toMistralMessages tests

This is the most complex method. It converts VS Code message objects (using `instanceof` checks) into Mistral API message arrays.

**Files:**
- Modify: `src/provider.ts`
- Modify: `src/provider.test.ts`

**Step 1: Append tests**

```typescript
// ── toMistralMessages ─────────────────────────────────────────────────────────

describe('MistralChatModelProvider — toMistralMessages', () => {
  let provider: MistralChatModelProvider

  // Helper: build a VS Code-style message
  function userMsg(...parts: any[]) {
    return { role: LanguageModelChatMessageRole.User, content: parts }
  }
  function assistantMsg(...parts: any[]) {
    return { role: LanguageModelChatMessageRole.Assistant, content: parts }
  }

  beforeEach(() => {
    provider = new MistralChatModelProvider(mockContext)
  })

  it('converts a plain text user message', () => {
    const msgs = provider.toMistralMessages([userMsg(new LanguageModelTextPart('Hello'))])
    expect(msgs).toEqual([{ role: 'user', content: 'Hello' }])
  })

  it('concatenates multiple text parts into one string', () => {
    const msgs = provider.toMistralMessages([
      userMsg(new LanguageModelTextPart('Hello'), new LanguageModelTextPart(' world')),
    ])
    expect(msgs).toEqual([{ role: 'user', content: 'Hello world' }])
  })

  it('converts a plain text assistant message', () => {
    const msgs = provider.toMistralMessages([assistantMsg(new LanguageModelTextPart('Hi'))])
    expect(msgs).toEqual([{ role: 'assistant', content: 'Hi', toolCalls: undefined }])
  })

  it('skips empty user messages', () => {
    const msgs = provider.toMistralMessages([userMsg()])
    expect(msgs).toHaveLength(0)
  })

  it('skips empty assistant messages (no content, no tool calls)', () => {
    const msgs = provider.toMistralMessages([assistantMsg()])
    expect(msgs).toHaveLength(0)
  })

  it('converts an assistant message with a tool call', () => {
    const toolCall = new LanguageModelToolCallPart('vsCode-id-1', 'search_files', { query: 'foo' })
    const msgs = provider.toMistralMessages([assistantMsg(toolCall)])

    expect(msgs).toHaveLength(1)
    const msg = msgs[0] as any
    expect(msg.role).toBe('assistant')
    expect(msg.content).toBeNull()
    expect(msg.toolCalls).toHaveLength(1)
    expect(msg.toolCalls[0].type).toBe('function')
    expect(msg.toolCalls[0].function.name).toBe('search_files')
    expect(JSON.parse(msg.toolCalls[0].function.arguments)).toEqual({ query: 'foo' })
  })

  it('converts a tool result message into role="tool"', () => {
    // First create the tool call so the mapping exists
    const toolCall = new LanguageModelToolCallPart('vsCode-id-2', 'read_file', { path: '/foo' })
    const toolResult = new LanguageModelToolResultPart('vsCode-id-2', [
      new LanguageModelTextPart('file contents'),
    ])

    const msgs = provider.toMistralMessages([
      assistantMsg(toolCall),
      userMsg(toolResult),
    ])

    const toolMsg = msgs.find((m: any) => m.role === 'tool') as any
    expect(toolMsg).toBeDefined()
    expect(toolMsg.content).toBe('file contents')
    expect(typeof toolMsg.toolCallId).toBe('string')
  })

  it('uses text content for tool result when available', () => {
    const toolCall = new LanguageModelToolCallPart('id-3', 'fn', {})
    const toolResult = new LanguageModelToolResultPart('id-3', [
      new LanguageModelTextPart('result text'),
    ])

    const msgs = provider.toMistralMessages([assistantMsg(toolCall), userMsg(toolResult)])
    const toolMsg = msgs.find((m: any) => m.role === 'tool') as any
    expect(toolMsg.content).toBe('result text')
  })

  it('encodes image data parts as base64 imageUrl chunks', () => {
    const imageData = new Uint8Array([1, 2, 3])
    const imgPart = new LanguageModelDataPart(imageData, 'image/png')
    const msgs = provider.toMistralMessages([userMsg(imgPart)])

    expect(msgs).toHaveLength(1)
    const content = (msgs[0] as any).content as any[]
    expect(content).toHaveLength(1)
    expect(content[0].type).toBe('image_url')
    expect(content[0].imageUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('stringifies non-image data parts as text placeholder', () => {
    const dataPart = new LanguageModelDataPart(new Uint8Array([0]), 'application/pdf')
    const msgs = provider.toMistralMessages([userMsg(dataPart)])

    expect(msgs).toHaveLength(1)
    expect((msgs[0] as any).content).toBe('[data:application/pdf]')
  })

  it('includes both text and image in a multimodal message', () => {
    const imageData = new Uint8Array([9, 8, 7])
    const msgs = provider.toMistralMessages([
      userMsg(
        new LanguageModelTextPart('Look at this:'),
        new LanguageModelDataPart(imageData, 'image/jpeg'),
      ),
    ])

    const content = (msgs[0] as any).content as any[]
    expect(content[0]).toEqual({ type: 'text', text: 'Look at this:' })
    expect(content[1].type).toBe('image_url')
  })

  it('assistant message with both text and tool calls includes both', () => {
    const toolCall = new LanguageModelToolCallPart('id-4', 'fn', {})
    const msgs = provider.toMistralMessages([
      assistantMsg(new LanguageModelTextPart('thinking...'), toolCall),
    ])

    const msg = msgs[0] as any
    expect(msg.content).toBe('thinking...')
    expect(msg.toolCalls).toHaveLength(1)
  })
})
```

**Step 2: Run — expect private access failure**

```bash
pnpm vitest run src/provider.test.ts
```

Expected: TypeScript/runtime error on `provider.toMistralMessages`.

**Step 3: Change `toMistralMessages` to public in `src/provider.ts`**

Line ~445: `private toMistralMessages(...)` → `public toMistralMessages(...)`

**Step 4: Run — expect all tests to pass**

```bash
pnpm vitest run src/provider.test.ts
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/provider.ts src/provider.test.ts
git commit -m "test: expose and test toMistralMessages"
```

---

### Task 8: extension.ts tests

**Files:**
- Create: `src/extension.test.ts`

**Step 1: Create the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { lm, commands } from 'vscode'
import { activate, deactivate } from './extension'

vi.mock('./provider', () => ({
  MistralChatModelProvider: vi.fn().mockImplementation(() => ({
    setApiKey: vi.fn(),
  })),
}))

describe('extension', () => {
  const mockContext = {
    subscriptions: { push: vi.fn() },
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('activate', () => {
    it('registers the language model chat provider', () => {
      activate(mockContext)
      expect(lm.registerLanguageModelChatProvider).toHaveBeenCalledWith('mistral', expect.any(Object))
    })

    it('registers the manageApiKey command', () => {
      activate(mockContext)
      expect(commands.registerCommand).toHaveBeenCalledWith(
        'mistral-chat.manageApiKey',
        expect.any(Function),
      )
    })

    it('pushes exactly 2 disposables into context.subscriptions', () => {
      activate(mockContext)
      expect(mockContext.subscriptions.push).toHaveBeenCalledTimes(1)
      const [disposables] = mockContext.subscriptions.push.mock.calls[0]
      expect(disposables).toHaveLength(2)
    })
  })

  describe('deactivate', () => {
    it('returns undefined', () => {
      expect(deactivate()).toBeUndefined()
    })
  })
})
```

**Step 2: Run**

```bash
pnpm vitest run src/extension.test.ts
```

Expected: all 4 tests pass.

**Step 3: Commit**

```bash
git add src/extension.test.ts
git commit -m "test: add extension activate/deactivate tests"
```

---

### Task 9: Full run and type-check

**Step 1: Run all tests**

```bash
pnpm vitest run
```

Expected: all tests pass, no failures.

**Step 2: Type-check**

```bash
pnpm check-types
```

Expected: no errors. If there are errors from changed `private` → `public` (there shouldn't be), fix them.

**Step 3: Final commit if any fixup was needed**

```bash
git add -p
git commit -m "fix: resolve type errors from visibility changes"
```
