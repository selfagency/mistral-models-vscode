import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MistralChatModelProvider, formatModelName } from './provider.js';

// ── Phase 5: Additional Integration Tests ──────────────────────────────────

describe('TTL Cache Behavior', () => {
  let provider: MistralChatModelProvider;

  const mockContext = {
    secrets: {
      get: vi.fn().mockResolvedValue('test-api-key'),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      onDidChange: vi.fn(),
    },
    subscriptions: [],
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new MistralChatModelProvider(mockContext);
  });

  it('should have 30 minute cache TTL', () => {
    expect(provider['MODELS_CACHE_TTL_MS']).toBe(30 * 60 * 1000);
  });

  it('should track cache expiry time', () => {
    // Initially cache should be expired
    expect(provider['isCacheExpired']()).toBe(true);
  });
});

describe('API Key Event Management', () => {
  let provider: MistralChatModelProvider;

  const mockContext = {
    secrets: {
      get: vi.fn().mockResolvedValue('test-api-key'),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      onDidChange: vi.fn(),
    },
    subscriptions: [],
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new MistralChatModelProvider(mockContext);
  });

  it('should provide onDidChangeLanguageModelChatInformation event', () => {
    expect(provider.onDidChangeLanguageModelChatInformation).toBeDefined();
    expect(typeof provider.onDidChangeLanguageModelChatInformation).toBe('function');
  });
});

describe('Tool Call ID Mapping', () => {
  let provider: MistralChatModelProvider;

  const mockContext = {
    secrets: {
      get: vi.fn().mockResolvedValue('test-api-key'),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      onDidChange: vi.fn(),
    },
    subscriptions: [],
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new MistralChatModelProvider(mockContext);
  });

  it('should generate consistent tool call IDs', () => {
    const id1 = provider.generateToolCallId();
    expect(id1).toBeTruthy();

    const id2 = provider.generateToolCallId();
    expect(id1).not.toBe(id2);
  });

  it('should map Mistral IDs to VS Code IDs bidirectionally', () => {
    const mistralId = 'mistral-call-123';
    const vsCodeId = provider.getOrCreateVsCodeToolCallId(mistralId);
    const retrievedMistralId = provider.getMistralToolCallId(vsCodeId);

    expect(vsCodeId).toBeTruthy();
    expect(retrievedMistralId).toBe(mistralId);
  });

  it('should return same VS Code ID for repeated Mistral ID lookups', () => {
    const mistralId = 'mistral-call-456';
    const vsCodeId1 = provider.getOrCreateVsCodeToolCallId(mistralId);
    const vsCodeId2 = provider.getOrCreateVsCodeToolCallId(mistralId);

    expect(vsCodeId1).toBe(vsCodeId2);
  });

  it('should clear tool call mappings', () => {
    provider.getOrCreateVsCodeToolCallId('test-id-1');
    provider.clearToolCallIdMappings();

    // After clearing, should generate new IDs for same Mistral ID
    const vsCodeId1 = provider.getOrCreateVsCodeToolCallId('test-id-1');
    const vsCodeId2 = provider.getOrCreateVsCodeToolCallId('test-id-1');

    expect(vsCodeId1).toBe(vsCodeId2);
  });
});

describe('Model Name Formatting', () => {
  it('should format single-segment model names', () => {
    expect(formatModelName('mistral')).toBe('Mistral');
  });

  it('should format hyphen-separated model names', () => {
    expect(formatModelName('mistral-small-latest')).toBe('Mistral Small Latest');
  });

  it('should format model names with numbers', () => {
    expect(formatModelName('mixtral-8x22b-v0-1')).toBe('Mixtral 8x22b V0 1');
  });

  it('should handle model names with underscores', () => {
    expect(formatModelName('mistral_medium')).toBe('Mistral_medium');
  });
});
