import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CancellationToken, ChatResponseStream, LanguageModelChatMessageRole, LanguageModelTextPart } from 'vscode';
import { MistralChatModelProvider, formatModelName } from './provider.js';

const mockWriteChunk = vi.fn(async () => {});
const mockEnd = vi.fn(async () => {});

vi.mock('@agentsy/vscode', () => ({
  ApiKeyManager: class {
    private key: string | undefined;

    constructor(
      private readonly context: {
        secrets: { get(key: string): Promise<string | undefined>; store(key: string, value: string): Promise<void> };
      },
      _config: unknown,
    ) {}

    async initialize() {
      this.key = await this.context.secrets.get('MISTRAL_API_KEY');
    }

    async getApiKey() {
      return this.key;
    }

    async setApiKey(key?: string) {
      if (!key) return;
      await this.context.secrets.store('MISTRAL_API_KEY', key);
      this.key = key;
    }

    onDidChangeApiKey(_listener: unknown) {}
  },
  createVSCodeAgentLoop: vi.fn().mockImplementation(() => ({
    write: vi.fn(async () => {}),
    writeChunk: mockWriteChunk,
    end: mockEnd,
  })),
  cancellationTokenToAbortSignal: vi.fn().mockImplementation(() => new AbortController().signal),
}));

vi.mock('@agentsy/normalizers', () => ({
  normalizeMistralChunk: vi.fn().mockImplementation((raw: unknown) => {
    if (!raw) {
      return null;
    }
    return { chunk: { content: 'ok' } };
  }),
}));

vi.mock('@agentsy/core/normalizers', () => {
  throw new Error('legacy @agentsy/core/normalizers should not be imported');
});

vi.mock('@agentsy/core/processor', () => {
  throw new Error('legacy @agentsy/core/processor should not be imported');
});

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

describe('Participant Streaming', () => {
  let provider: MistralChatModelProvider;

  const mockContext = {
    secrets: {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      onDidChange: vi.fn(),
    },
    subscriptions: [],
  } as any;

  const createStream = () => ({
    markdown: vi.fn(),
    progress: vi.fn(),
    anchor: vi.fn(),
    reference: vi.fn(),
    button: vi.fn(),
    filetree: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new MistralChatModelProvider(mockContext, undefined, false);
  });

  it('should prompt to set API key when no client is initialized', async () => {
    const stream = createStream();

    await provider.streamParticipantResponse(
      'mistral-large-latest',
      [{ role: LanguageModelChatMessageRole.User, content: [new LanguageModelTextPart('hi')], name: undefined }],
      stream as unknown as ChatResponseStream,
      {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
      } as CancellationToken,
    );

    expect(stream.markdown).toHaveBeenCalledWith('Please add your Mistral API key to use Mistral AI.');
  });

  it('should stream normalized chunks through agentsy renderer', async () => {
    const stream = createStream();
    (provider as unknown as { client?: unknown }).client = {
      chat: {
        stream: vi.fn().mockResolvedValue(
          (async function* () {
            yield { data: { choices: [{ delta: { content: 'hello' } }] } };
          })(),
        ),
      },
    };
    vi.spyOn(provider, 'fetchModels').mockResolvedValue([
      {
        id: 'mistral-large-latest',
        name: 'Mistral Large Latest',
        maxInputTokens: 32000,
        maxOutputTokens: 8000,
        defaultCompletionTokens: 4000,
        toolCalling: false,
        supportsParallelToolCalls: false,
      },
    ] as unknown as any);

    await provider.streamParticipantResponse(
      'mistral-large-latest',
      [{ role: LanguageModelChatMessageRole.User, content: [new LanguageModelTextPart('hi')] } as any],
      stream as any,
      { isCancellationRequested: false, onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) } as any,
    );

    expect(mockWriteChunk).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it('should emit cancellation message when token is already cancelled', async () => {
    const stream = createStream();

    await provider.streamParticipantResponse(
      'mistral-large-latest',
      [{ role: LanguageModelChatMessageRole.User, content: [new LanguageModelTextPart('hi')] } as any],
      stream as any,
      { isCancellationRequested: true, onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) } as any,
    );

    expect(stream.markdown).toHaveBeenCalledWith('Request cancelled.');
  });
});
