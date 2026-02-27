import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LanguageModelChatMessageRole,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  LanguageModelDataPart,
} from 'vscode';
import { formatModelName, getChatModelInfo, toMistralRole, MistralChatModelProvider } from './provider';

// ── Shared mock context ───────────────────────────────────────────────────────

const mockContext = {
  secrets: {
    get: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    onDidChange: vi.fn(),
  },
  subscriptions: [],
} as any;

// ── formatModelName ───────────────────────────────────────────────────────────

describe('formatModelName', () => {
  it('capitalises a single segment', () => {
    expect(formatModelName('mistral')).toBe('Mistral');
  });

  it('capitalises each hyphen-separated segment', () => {
    expect(formatModelName('mistral-large-latest')).toBe('Mistral Large Latest');
  });

  it('handles numeric segments without error', () => {
    expect(formatModelName('devstral-small-2505')).toBe('Devstral Small 2505');
  });
});

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
  };

  it('maps all fields correctly', () => {
    const info = getChatModelInfo(base);
    expect(info.id).toBe('mistral-large-latest');
    expect(info.name).toBe('Mistral Large');
    expect(info.family).toBe('mistral');
    expect(info.maxInputTokens).toBe(128000);
    expect(info.maxOutputTokens).toBe(16384);
    expect(info.capabilities?.toolCalling).toBe(true);
    expect(info.capabilities?.imageInput).toBe(true);
  });

  it('tooltip includes detail when present', () => {
    const info = getChatModelInfo({ ...base, detail: 'Latest flagship' });
    expect(info.tooltip).toBe('Mistral Mistral Large - Latest flagship');
  });

  it('tooltip omits detail when absent', () => {
    const info = getChatModelInfo(base);
    expect(info.tooltip).toBe('Mistral Mistral Large');
  });

  it('imageInput is false when supportsVision is false', () => {
    const info = getChatModelInfo({ ...base, supportsVision: false });
    expect(info.capabilities?.imageInput).toBe(false);
  });

  it('imageInput is false when supportsVision is undefined', () => {
    const { supportsVision: _, ...noVision } = base;
    const info = getChatModelInfo(noVision as any);
    expect(info.capabilities?.imageInput).toBe(false);
  });
});

// ── toMistralRole ─────────────────────────────────────────────────────────────

describe('toMistralRole', () => {
  it('maps User to "user"', () => {
    expect(toMistralRole(LanguageModelChatMessageRole.User)).toBe('user');
  });

  it('maps Assistant to "assistant"', () => {
    expect(toMistralRole(LanguageModelChatMessageRole.Assistant)).toBe('assistant');
  });

  it('maps unknown values to "user"', () => {
    expect(toMistralRole(99 as any)).toBe('user');
  });
});

// ── Tool call ID mapping ──────────────────────────────────────────────────────

describe('MistralChatModelProvider — tool call ID mapping', () => {
  let provider: MistralChatModelProvider;

  beforeEach(() => {
    provider = new MistralChatModelProvider(mockContext);
  });

  describe('generateToolCallId', () => {
    it('returns a 9-character string', () => {
      expect(provider.generateToolCallId()).toHaveLength(9);
    });

    it('returns only alphanumeric characters', () => {
      const id = provider.generateToolCallId();
      expect(id).toMatch(/^[a-zA-Z0-9]{9}$/);
    });

    it('produces unique IDs across calls', () => {
      const ids = new Set(Array.from({ length: 20 }, () => provider.generateToolCallId()));
      expect(ids.size).toBeGreaterThan(1);
    });
  });

  describe('getOrCreateVsCodeToolCallId', () => {
    it('returns a 9-character alphanumeric ID for a new Mistral ID', () => {
      const id = provider.getOrCreateVsCodeToolCallId('mistral-abc');
      expect(id).toMatch(/^[a-zA-Z0-9]{9}$/);
    });

    it('returns the same VS Code ID for the same Mistral ID (idempotent)', () => {
      const first = provider.getOrCreateVsCodeToolCallId('mistral-abc');
      const second = provider.getOrCreateVsCodeToolCallId('mistral-abc');
      expect(first).toBe(second);
    });

    it('creates distinct VS Code IDs for different Mistral IDs', () => {
      const a = provider.getOrCreateVsCodeToolCallId('mistral-aaa');
      const b = provider.getOrCreateVsCodeToolCallId('mistral-bbb');
      expect(a).not.toBe(b);
    });

    it('registers the bidirectional mapping so getMistralToolCallId resolves back', () => {
      const vsCodeId = provider.getOrCreateVsCodeToolCallId('mistral-xyz');
      expect(provider.getMistralToolCallId(vsCodeId)).toBe('mistral-xyz');
    });
  });

  describe('getMistralToolCallId', () => {
    it('returns the Mistral ID for a known VS Code ID', () => {
      const vsCodeId = provider.getOrCreateVsCodeToolCallId('mistral-known');
      expect(provider.getMistralToolCallId(vsCodeId)).toBe('mistral-known');
    });

    it('returns undefined for an unknown VS Code ID', () => {
      expect(provider.getMistralToolCallId('unknown-id')).toBeUndefined();
    });
  });

  describe('clearToolCallIdMappings', () => {
    it('makes previously mapped IDs no longer resolvable', () => {
      const vsCodeId = provider.getOrCreateVsCodeToolCallId('mistral-to-clear');
      provider.clearToolCallIdMappings();
      expect(provider.getMistralToolCallId(vsCodeId)).toBeUndefined();
    });

    it('subsequent getOrCreate after clear creates a fresh (possibly different) ID', () => {
      const before = provider.getOrCreateVsCodeToolCallId('mistral-refresh');
      provider.clearToolCallIdMappings();
      const after = provider.getOrCreateVsCodeToolCallId('mistral-refresh');
      expect(after).toMatch(/^[a-zA-Z0-9]{9}$/);
      expect(provider.getMistralToolCallId(before)).toBeUndefined();
    });
  });
});

// ── fetchModels ───────────────────────────────────────────────────────────────

describe('MistralChatModelProvider — fetchModels', () => {
  let provider: MistralChatModelProvider;

  const chatModel = {
    id: 'mistral-large-latest',
    name: 'Mistral Large',
    description: 'Flagship model',
    maxContextLength: 128000,
    defaultModelTemperature: 0.7,
    capabilities: { completionChat: true, functionCalling: true, vision: true },
  };

  const embedModel = {
    id: 'mistral-embed',
    name: null,
    description: null,
    maxContextLength: 8192,
    defaultModelTemperature: null,
    capabilities: { completionChat: false, functionCalling: false, vision: false },
  };

  beforeEach(() => {
    provider = new MistralChatModelProvider(mockContext);
  });

  it('returns empty array when no client is set', async () => {
    const models = await provider.fetchModels();
    expect(models).toEqual([]);
  });

  it('filters out models without completionChat capability', async () => {
    const mockList = vi.fn().mockResolvedValue({ data: [chatModel, embedModel] });
    (provider as any).client = { models: { list: mockList } };

    const models = await provider.fetchModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('mistral-large-latest');
  });

  it('maps API fields to MistralModel correctly', async () => {
    const mockList = vi.fn().mockResolvedValue({ data: [chatModel] });
    (provider as any).client = { models: { list: mockList } };

    const [model] = await provider.fetchModels();
    expect(model.name).toBe('Mistral Large');
    expect(model.detail).toBe('Flagship model');
    expect(model.maxInputTokens).toBe(128000);
    expect(model.toolCalling).toBe(true);
    expect(model.supportsParallelToolCalls).toBe(true);
    expect(model.supportsVision).toBe(true);
    expect(model.temperature).toBe(0.7);
  });

  it('falls back to formatModelName when name is null', async () => {
    const noName = { ...chatModel, name: null };
    const mockList = vi.fn().mockResolvedValue({ data: [noName] });
    (provider as any).client = { models: { list: mockList } };

    const [model] = await provider.fetchModels();
    expect(model.name).toBe('Mistral Large Latest');
  });

  it('caches the result — second call does not hit the API', async () => {
    const mockList = vi.fn().mockResolvedValue({ data: [chatModel] });
    (provider as any).client = { models: { list: mockList } };

    await provider.fetchModels();
    await provider.fetchModels();
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('returns empty array and does not throw on API error', async () => {
    const mockList = vi.fn().mockRejectedValue(new Error('network error'));
    (provider as any).client = { models: { list: mockList } };

    const models = await provider.fetchModels();
    expect(models).toEqual([]);
  });

  it('cache is cleared when fetchedModels is reset to null', async () => {
    const mockList = vi.fn().mockResolvedValue({ data: [chatModel] });
    (provider as any).client = { models: { list: mockList } };
    await provider.fetchModels();

    (provider as any).fetchedModels = null;
    (provider as any).client = { models: { list: mockList } };

    await provider.fetchModels();
    expect(mockList).toHaveBeenCalledTimes(2);
  });
});

// ── toMistralMessages ─────────────────────────────────────────────────────────

describe('MistralChatModelProvider — toMistralMessages', () => {
  let provider: MistralChatModelProvider;

  function userMsg(...parts: any[]) {
    return { role: LanguageModelChatMessageRole.User, content: parts };
  }
  function assistantMsg(...parts: any[]) {
    return { role: LanguageModelChatMessageRole.Assistant, content: parts };
  }

  beforeEach(() => {
    provider = new MistralChatModelProvider(mockContext);
  });

  it('converts a plain text user message', () => {
    const msgs = provider.toMistralMessages([userMsg(new LanguageModelTextPart('Hello'))]);
    expect(msgs).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('concatenates multiple text parts into one string', () => {
    const msgs = provider.toMistralMessages([
      userMsg(new LanguageModelTextPart('Hello'), new LanguageModelTextPart(' world')),
    ]);
    expect(msgs).toEqual([{ role: 'user', content: 'Hello world' }]);
  });

  it('converts a plain text assistant message', () => {
    const msgs = provider.toMistralMessages([assistantMsg(new LanguageModelTextPart('Hi'))]);
    expect(msgs).toEqual([{ role: 'assistant', content: 'Hi', toolCalls: undefined }]);
  });

  it('skips empty user messages', () => {
    const msgs = provider.toMistralMessages([userMsg()]);
    expect(msgs).toHaveLength(0);
  });

  it('skips empty assistant messages (no content, no tool calls)', () => {
    const msgs = provider.toMistralMessages([assistantMsg()]);
    expect(msgs).toHaveLength(0);
  });

  it('converts an assistant message with a tool call', () => {
    const toolCall = new LanguageModelToolCallPart('vsCode-id-1', 'search_files', { query: 'foo' });
    const msgs = provider.toMistralMessages([assistantMsg(toolCall)]);

    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as any;
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBeNull();
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls[0].type).toBe('function');
    expect(msg.toolCalls[0].function.name).toBe('search_files');
    expect(JSON.parse(msg.toolCalls[0].function.arguments)).toEqual({ query: 'foo' });
  });

  it('converts a tool result message into role="tool"', () => {
    const toolCall = new LanguageModelToolCallPart('vsCode-id-2', 'read_file', { path: '/foo' });
    const toolResult = new LanguageModelToolResultPart('vsCode-id-2', [new LanguageModelTextPart('file contents')]);

    const msgs = provider.toMistralMessages([assistantMsg(toolCall), userMsg(toolResult)]);

    const toolMsg = msgs.find((m: any) => m.role === 'tool') as any;
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toBe('file contents');
    expect(typeof toolMsg.toolCallId).toBe('string');
  });

  it('uses text content for tool result when available', () => {
    const toolCall = new LanguageModelToolCallPart('id-3', 'fn', {});
    const toolResult = new LanguageModelToolResultPart('id-3', [new LanguageModelTextPart('result text')]);

    const msgs = provider.toMistralMessages([assistantMsg(toolCall), userMsg(toolResult)]);
    const toolMsg = msgs.find((m: any) => m.role === 'tool') as any;
    expect(toolMsg.content).toBe('result text');
  });

  it('encodes image data parts as base64 imageUrl chunks', () => {
    const imageData = new Uint8Array([1, 2, 3]);
    const imgPart = new LanguageModelDataPart(imageData, 'image/png');
    const msgs = provider.toMistralMessages([userMsg(imgPart)]);

    expect(msgs).toHaveLength(1);
    const content = (msgs[0] as any).content as any[];
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('image_url');
    expect(content[0].imageUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('stringifies non-image data parts as text placeholder', () => {
    const dataPart = new LanguageModelDataPart(new Uint8Array([0]), 'application/pdf');
    const msgs = provider.toMistralMessages([userMsg(dataPart)]);

    expect(msgs).toHaveLength(1);
    expect((msgs[0] as any).content).toBe('[data:application/pdf]');
  });

  it('includes both text and image in a multimodal message', () => {
    const imageData = new Uint8Array([9, 8, 7]);
    const msgs = provider.toMistralMessages([
      userMsg(new LanguageModelTextPart('Look at this:'), new LanguageModelDataPart(imageData, 'image/jpeg')),
    ]);

    const content = (msgs[0] as any).content as any[];
    expect(content[0]).toEqual({ type: 'text', text: 'Look at this:' });
    expect(content[1].type).toBe('image_url');
  });

  it('assistant message with both text and tool calls includes both', () => {
    const toolCall = new LanguageModelToolCallPart('id-4', 'fn', {});
    const msgs = provider.toMistralMessages([assistantMsg(new LanguageModelTextPart('thinking...'), toolCall)]);

    const msg = msgs[0] as any;
    expect(msg.content).toBe('thinking...');
    expect(msg.toolCalls).toHaveLength(1);
  });
});
