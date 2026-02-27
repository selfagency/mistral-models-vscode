# Chat Participant Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `@mistral` VS Code chat participant that routes requests through `request.model.sendRequest()` and streams the response back as markdown.

**Architecture:** The participant is registered in `package.json` under `contributes.chatParticipants` and created in `activate()` alongside the existing LM provider and command. The handler builds `LanguageModelChatMessage[]` from `context.history` + `request.prompt`, calls `request.model.sendRequest()`, and pipes each text chunk to `stream.markdown()`. No new files needed.

**Tech Stack:** VS Code Extension API (`vscode.chat`, `vscode.LanguageModelChatMessage`), TypeScript, vitest for tests.

---

### Task 1: Extend the VS Code stub module

The existing `src/test/vscode.mock.ts` stub needs new exports that the participant code and its tests depend on. Add them before writing any tests so the test files can compile.

**Files:**
- Modify: `src/test/vscode.mock.ts`

**Step 1: Add the new stubs to the end of `src/test/vscode.mock.ts`**

Append after the last `export const commands` block:

```typescript
export class MarkdownString {
  constructor(public readonly value: string) {}
}

export class LanguageModelChatMessage {
  static User(content: string, name?: string): LanguageModelChatMessage {
    return new LanguageModelChatMessage(LanguageModelChatMessageRole.User, content, name)
  }
  static Assistant(content: string, name?: string): LanguageModelChatMessage {
    return new LanguageModelChatMessage(LanguageModelChatMessageRole.Assistant, content, name)
  }
  constructor(
    public readonly role: LanguageModelChatMessageRole,
    public readonly content: string,
    public readonly name?: string,
  ) {}
}

export class ChatRequestTurn {
  constructor(public readonly prompt: string) {}
}

export class ChatResponseTurn {
  constructor(public readonly response: ChatResponseMarkdownPart[]) {}
}

export class ChatResponseMarkdownPart {
  constructor(public readonly value: MarkdownString) {}
}

export const Uri = {
  joinPath: vi.fn().mockReturnValue(undefined),
}

export const chat = {
  createChatParticipant: vi.fn().mockReturnValue({ iconPath: undefined, dispose: vi.fn() }),
}
```

**Step 2: Verify the stub compiles**

```bash
cd /Users/daniel/Developer/mistral-models-vscode && pnpm check-types
```

Expected: no new type errors.

**Step 3: Commit**

```bash
git add src/test/vscode.mock.ts
git commit -m "test: extend VS Code stub with chat participant types"
```

---

### Task 2: Write failing tests

Write the tests first (TDD red phase). They will fail because `extension.ts` doesn't yet call `vscode.chat.createChatParticipant`.

**Files:**
- Modify: `src/extension.test.ts`

**Step 1: Update `src/extension.test.ts`**

Replace the entire file with this:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lm, commands, chat, ChatRequestTurn, ChatResponseTurn, ChatResponseMarkdownPart, MarkdownString, LanguageModelTextPart } from 'vscode';
import { activate, deactivate } from './extension';

vi.mock('./provider', () => ({
  MistralChatModelProvider: vi.fn().mockImplementation(function () {
    return { setApiKey: vi.fn() };
  }),
}));

describe('extension', () => {
  const mockContext = {
    subscriptions: { push: vi.fn() },
    extensionUri: '/fake-extension',
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('activate', () => {
    it('registers the language model chat provider', () => {
      activate(mockContext);
      expect(lm.registerLanguageModelChatProvider).toHaveBeenCalledWith('mistral', expect.any(Object));
    });

    it('registers the manageApiKey command', () => {
      activate(mockContext);
      expect(commands.registerCommand).toHaveBeenCalledWith('mistral-chat.manageApiKey', expect.any(Function));
    });

    it('pushes exactly 2 disposables into context.subscriptions (provider + command)', () => {
      activate(mockContext);
      // First push call is provider + command bundled together
      expect(mockContext.subscriptions.push.mock.calls[0]).toHaveLength(2);
    });

    it('creates the @mistral chat participant', () => {
      activate(mockContext);
      expect(chat.createChatParticipant).toHaveBeenCalledWith(
        'mistral-ai-copilot-chat.mistral',
        expect.any(Function),
      );
    });

    it('pushes participant disposable into context.subscriptions', () => {
      activate(mockContext);
      // Second push call is the participant
      expect(mockContext.subscriptions.push).toHaveBeenCalledTimes(2);
      expect(mockContext.subscriptions.push.mock.calls[1]).toHaveLength(1);
    });
  });

  describe('activate — participant handler', () => {
    async function getHandler() {
      activate(mockContext);
      const [, handler] = (chat.createChatParticipant as ReturnType<typeof vi.fn>).mock.calls[0];
      return handler;
    }

    it('sends history + prompt to request.model.sendRequest', async () => {
      const handler = await getHandler();

      const mockStream = { markdown: vi.fn() };
      const mockResponse = {
        stream: (async function* () {
          yield new LanguageModelTextPart('world');
        })(),
      };
      const mockSendRequest = vi.fn().mockResolvedValue(mockResponse);

      const mockRequest = { prompt: 'hello', model: { sendRequest: mockSendRequest } };
      const mockChatContext = { history: [] };
      const mockToken = { isCancellationRequested: false };

      await handler(mockRequest, mockChatContext, mockStream, mockToken);

      expect(mockSendRequest).toHaveBeenCalledOnce();
      const [messages] = mockSendRequest.mock.calls[0];
      // Last message is the current prompt
      expect(messages.at(-1).content).toBe('hello');
    });

    it('streams text chunks back as markdown', async () => {
      const handler = await getHandler();

      const mockStream = { markdown: vi.fn() };
      const mockResponse = {
        stream: (async function* () {
          yield new LanguageModelTextPart('chunk1');
          yield new LanguageModelTextPart('chunk2');
        })(),
      };
      const mockSendRequest = vi.fn().mockResolvedValue(mockResponse);

      await handler(
        { prompt: 'test', model: { sendRequest: mockSendRequest } },
        { history: [] },
        mockStream,
        { isCancellationRequested: false },
      );

      expect(mockStream.markdown).toHaveBeenCalledWith('chunk1');
      expect(mockStream.markdown).toHaveBeenCalledWith('chunk2');
    });

    it('includes prior ChatRequestTurn as a User message in history', async () => {
      const handler = await getHandler();

      const mockResponse = { stream: (async function* () {})() };
      const mockSendRequest = vi.fn().mockResolvedValue(mockResponse);

      const priorRequest = new ChatRequestTurn('prior question');
      await handler(
        { prompt: 'follow-up', model: { sendRequest: mockSendRequest } },
        { history: [priorRequest] },
        { markdown: vi.fn() },
        { isCancellationRequested: false },
      );

      const [messages] = mockSendRequest.mock.calls[0];
      expect(messages[0].content).toBe('prior question');
      expect(messages[1].content).toBe('follow-up');
    });

    it('includes prior ChatResponseTurn as an Assistant message in history', async () => {
      const handler = await getHandler();

      const mockResponse = { stream: (async function* () {})() };
      const mockSendRequest = vi.fn().mockResolvedValue(mockResponse);

      const priorResponse = new ChatResponseTurn([
        new ChatResponseMarkdownPart(new MarkdownString('prior answer')),
      ]);
      await handler(
        { prompt: 'next', model: { sendRequest: mockSendRequest } },
        { history: [priorResponse] },
        { markdown: vi.fn() },
        { isCancellationRequested: false },
      );

      const [messages] = mockSendRequest.mock.calls[0];
      expect(messages[0].content).toBe('prior answer');
    });

    it('surfaces errors as a markdown message', async () => {
      const handler = await getHandler();

      const mockStream = { markdown: vi.fn() };
      const mockSendRequest = vi.fn().mockRejectedValue(new Error('model unavailable'));

      await handler(
        { prompt: 'hi', model: { sendRequest: mockSendRequest } },
        { history: [] },
        mockStream,
        { isCancellationRequested: false },
      );

      expect(mockStream.markdown).toHaveBeenCalledWith(expect.stringContaining('model unavailable'));
    });
  });

  describe('deactivate', () => {
    it('returns undefined', () => {
      expect(deactivate()).toBeUndefined();
    });
  });
});
```

**Step 2: Run — expect failures on `chat.createChatParticipant` assertions**

```bash
cd /Users/daniel/Developer/mistral-models-vscode && pnpm vitest run src/extension.test.ts
```

Expected: `creates the @mistral chat participant` and `pushes participant disposable` fail. The handler tests also fail. The existing tests (registers provider, registers command, deactivate) still pass.

**Step 3: Commit the failing tests**

```bash
git add src/extension.test.ts
git commit -m "test: add failing tests for chat participant registration and handler"
```

---

### Task 3: Update package.json

No tests for JSON — just add the contribution points.

**Files:**
- Modify: `package.json`

**Step 1: Add `chatParticipants` to `contributes`**

In `package.json`, inside the `"contributes"` object (after the closing `]` of `"commands"`), add:

```json
"chatParticipants": [
  {
    "id": "mistral-ai-copilot-chat.mistral",
    "name": "mistral",
    "fullName": "Mistral AI",
    "description": "Chat with a Mistral AI model",
    "isSticky": true
  }
]
```

**Step 2: Add activation event**

In `"activationEvents"`, append:

```json
"onChatParticipant:mistral-ai-copilot-chat.mistral"
```

**Step 3: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid')"
```

Expected: `valid`

**Step 4: Commit**

```bash
git add package.json
git commit -m "feat: register @mistral chat participant in package.json"
```

---

### Task 4: Implement the participant in extension.ts

Now implement the handler to make the failing tests pass (TDD green phase).

**Files:**
- Modify: `src/extension.ts`

**Step 1: Replace `src/extension.ts` with the following**

```typescript
import * as vscode from 'vscode';
import { MistralChatModelProvider } from './provider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new MistralChatModelProvider(context);
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('mistral', provider),
    vscode.commands.registerCommand('mistral-chat.manageApiKey', async () => {
      await provider.setApiKey();
    }),
  );

  const participantHandler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> => {
    const messages: vscode.LanguageModelChatMessage[] = [];

    for (const turn of chatContext.history) {
      if (turn instanceof vscode.ChatRequestTurn) {
        messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
      } else if (turn instanceof vscode.ChatResponseTurn) {
        const text = turn.response
          .filter((r): r is vscode.ChatResponseMarkdownPart => r instanceof vscode.ChatResponseMarkdownPart)
          .map(r => r.value.value)
          .join('');
        if (text) {
          messages.push(vscode.LanguageModelChatMessage.Assistant(text));
        }
      }
    }

    messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

    try {
      const response = await request.model.sendRequest(messages, {}, token);
      for await (const chunk of response.stream) {
        if (chunk instanceof vscode.LanguageModelTextPart) {
          stream.markdown(chunk.value);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      stream.markdown(`Error: ${message}`);
    }
  };

  const participant = vscode.chat.createChatParticipant('mistral-ai-copilot-chat.mistral', participantHandler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'logo.png');
  context.subscriptions.push(participant);
}

export function deactivate() {}
```

**Step 2: Run tests — expect all tests to pass**

```bash
cd /Users/daniel/Developer/mistral-models-vscode && pnpm vitest run src/extension.test.ts
```

Expected: all tests pass. If a test fails, debug the specific assertion before moving on.

**Debugging tips:**
- If `chat.createChatParticipant` assertion fails: make sure `vscode.chat` is exported from the mock and `extension.ts` calls `vscode.chat.createChatParticipant` (not a local import)
- If handler tests fail on `LanguageModelTextPart instanceof` check: the mock's `LanguageModelTextPart` class must be the same object as the one used in the test — it is, since both import from the `vscode` alias

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: add @mistral chat participant with history-aware handler"
```

---

### Task 5: Full run and type-check

**Step 1: Run all tests**

```bash
cd /Users/daniel/Developer/mistral-models-vscode && pnpm vitest run
```

Expected: all tests pass (provider tests + extension tests).

**Step 2: Type-check**

```bash
cd /Users/daniel/Developer/mistral-models-vscode && pnpm check-types
```

Expected: no errors. Common issues to fix if they appear:
- `vscode.ChatRequestTurn`, `vscode.ChatResponseTurn`, `vscode.ChatResponseMarkdownPart` — available in `@types/vscode ^1.85`. The project targets `^1.104.0` so these exist.
- `vscode.Uri.joinPath` — available since VS Code 1.46. Fine here.
- If `participant.iconPath` is not assignable: set it with `as any` cast as a last resort.

**Step 3: Final commit if any fixups were needed**

```bash
git add -p
git commit -m "fix: resolve type errors from chat participant implementation"
```
