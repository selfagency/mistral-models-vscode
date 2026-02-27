# Chat Participant Design

**Date:** 2026-02-27
**Scope:** Add a `@mistral` VS Code chat participant that routes requests through `request.model`.

## Approach

Option A: thin delegate. The handler builds messages from `context.history` + `request.prompt` and calls `request.model.sendRequest()`. No new files; handler lives in `extension.ts`.

## Changes to `package.json`

### Add `chatParticipants` contribution

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

### Add activation event

```json
"onChatParticipant:mistral-ai-copilot-chat.mistral"
```

## Changes to `extension.ts`

### Handler logic

1. Build history: for each `ChatRequestTurn` / `ChatResponseTurn` in `context.history`, emit a `User` or `Assistant` `LanguageModelChatMessage`
2. Append current `request.prompt` as a `User` message
3. Call `request.model.sendRequest(messages, {}, token)`
4. For each chunk in `response.stream`, call `stream.markdown(chunk.text)`
5. On error, surface it via `stream.markdown('Error: ...')`

### Registration

```typescript
const participant = vscode.chat.createChatParticipant(
  'mistral-ai-copilot-chat.mistral',
  handler,
)
participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'logo.png')
context.subscriptions.push(participant)
```

Push as a separate `subscriptions.push` call, not bundled with the provider + command.

## Changes to `src/extension.test.ts`

- Add test: `creates the @mistral chat participant`
- Update the existing "pushes exactly 2 disposables" test — the participant is pushed separately, so the existing test remains valid (it asserts the first `push` call has 2 items; the participant is a second `push` call).

## File Summary

| File | Action |
|---|---|
| `package.json` | Add `chatParticipants` entry + activation event |
| `src/extension.ts` | Add handler (~25 lines) + `createChatParticipant` call |
| `src/extension.test.ts` | Add 1 test for participant registration |
