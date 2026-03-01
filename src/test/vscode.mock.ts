import { vi } from 'vitest';

export interface LanguageModelChatInformation {
  id: string;
  name: string;
  family?: string;
  version?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  detail?: string;
  tooltip?: string;
  capabilities?: {
    toolCalling?: boolean;
    imageInput?: boolean;
  };
}

export interface LanguageModelChatProvider {}

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
};

export const lm = {
  registerLanguageModelChatProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

export const commands = {
  registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

export class MarkdownString {
  constructor(public readonly value: string) {}
}

export class LanguageModelChatMessage {
  static User(content: string, name?: string): LanguageModelChatMessage {
    return new LanguageModelChatMessage(LanguageModelChatMessageRole.User, content, name);
  }
  static Assistant(content: string, name?: string): LanguageModelChatMessage {
    return new LanguageModelChatMessage(LanguageModelChatMessageRole.Assistant, content, name);
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
};

export const chat = {
  createChatParticipant: vi.fn().mockReturnValue({ iconPath: undefined, dispose: vi.fn() }),
};
