import {
	CancellationToken,
	ExtensionContext,
	InputBoxValidationSeverity,
	LanguageModelChatInformation,
	LanguageModelChatMessage,
	LanguageModelChatMessageRole,
	LanguageModelChatProvider,
	LanguageModelResponsePart,
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	Progress,
	ProvideLanguageModelChatResponseOptions,
	window
} from "vscode";
import { Mistral } from "@mistralai/mistralai";
import { get_encoding, Tiktoken } from "tiktoken";

/**
 * Mistral model configuration
 */
interface MistralModel {
	id: string;
	name: string;
	detail?: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	defaultCompletionTokens: number;
	toolCalling: boolean;
	supportsParallelToolCalls: boolean;
	supportsVision?: boolean;
	temperature?: number;
	top_p?: number;
}

// Default completion tokens for rate limiting optimization
const DEFAULT_COMPLETION_TOKENS = 65536;

/**
 * Mistral Models - Updated December 2025
 * 
 * Devstral models: Optimized for agentic coding and software engineering tasks
 * Mistral Large/Medium: General-purpose flagship models
 */
const MISTRAL_MODELS: MistralModel[] = [
	// === Devstral Models (Code-Optimized) ===
	{
		id: "devstral-small-latest",
		name: "Devstral Small 2",
		maxInputTokens: 256000,
		maxOutputTokens: 65536,
		defaultCompletionTokens: DEFAULT_COMPLETION_TOKENS,
		toolCalling: true,
		supportsParallelToolCalls: true,
		supportsVision: false
	},
	{
		id: "devstral-latest",
		name: "Devstral 2",
		maxInputTokens: 256000,
		maxOutputTokens: 65536,
		defaultCompletionTokens: DEFAULT_COMPLETION_TOKENS,
		toolCalling: true,
		supportsParallelToolCalls: true,
		supportsVision: false
	},
	// === Flagship General-Purpose Models ===
	{
		id: "mistral-large-latest",
		name: "Mistral Large 3",
		maxInputTokens: 256000,
		maxOutputTokens: 16384,
		defaultCompletionTokens: DEFAULT_COMPLETION_TOKENS,
		toolCalling: true,
		supportsParallelToolCalls: true,
		supportsVision: true
	}
];

/**
 * Get chat model information for VS Code Language Model API
 */
function getChatModelInfo(model: MistralModel): LanguageModelChatInformation {
	return {
		id: model.id,
		name: model.name,
		tooltip: `Mistral ${model.name} - ${model.detail}`,
		family: "mistral",
		detail: model.detail,
		maxInputTokens: model.maxInputTokens,
		maxOutputTokens: model.maxOutputTokens,
		version: "1.0.0",
		capabilities: {
			toolCalling: model.toolCalling,
			imageInput: model.supportsVision ?? false,
		}
	};
}

/**
 * Message types for Mistral API
 */
type MistralRole = "system" | "user" | "assistant" | "tool";

interface MistralMessage {
	role: MistralRole;
	content: string;
	tool_calls?: Array<{
		id: string;
		type: "function";
		function: {
			name: string;
			arguments: string;
		};
	}>;
	tool_call_id?: string;
}

/**
 * Mistral Chat Model Provider
 * Implements VS Code's LanguageModelChatProvider interface for GitHub Copilot Chat
 */
export class MistralChatModelProvider implements LanguageModelChatProvider {
	private client: Mistral | null = null;
	private tokenizer: Tiktoken | null = null;

	constructor(private readonly context: ExtensionContext) { }

	/**
	 * Prompts the user to enter their Mistral API key and stores it securely.
	 * @returns A promise that resolves to the entered API key if valid, or undefined if cancelled
	 */
	public async setApiKey(): Promise<string | undefined> {
		let apiKey: string | undefined = await this.context.secrets.get('MISTRAL_API_KEY');
		apiKey = await window.showInputBox({
			placeHolder: "Mistral API Key",
			password: true,
			value: apiKey || '',
			prompt: "Enter your Mistral API key (get one at https://console.mistral.ai/)",
			ignoreFocusOut: true,
			validateInput: (value) => {
				if (!value || value.trim().length === 0) {
					return { message: "API key is required", severity: InputBoxValidationSeverity.Error };
				}
				// Mistral API keys are typically long alphanumeric strings
				if (value.length < 20) {
					return { message: "API key appears too short", severity: InputBoxValidationSeverity.Warning };
				}
			}
		});

		if (!apiKey) {
			return undefined;
		}

		void this.context.secrets.store('MISTRAL_API_KEY', apiKey);
		this.client = new Mistral({
			apiKey: apiKey
		});

		return apiKey;
	}

	/**
	 * Initialize the Mistral client.
	 * @param silent Whether to initialize silently without prompting for API key
	 * @returns Whether the initialization was successful
	 */
	private async initClient(silent: boolean): Promise<boolean> {
		if (this.client) {
			return true;
		}

		let apiKey: string | undefined = await this.context.secrets.get('MISTRAL_API_KEY');
		if (!silent && !apiKey) {
			apiKey = await this.setApiKey();
		} else if (apiKey) {
			this.client = new Mistral({
				apiKey: apiKey
			});
		}

		return !!apiKey;
	}

	/**
	 * Provide available chat model information
	 */
	async provideLanguageModelChatInformation(
		options: { silent: boolean; },
		_token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		const initialized = await this.initClient(options.silent);
		if (!initialized) {
			console.warn('Mistral client not initialized. Please set your API key.');
			return [];
		}

		return MISTRAL_MODELS.map(model => getChatModelInfo(model));
	}

	/**
	 * Provide chat response from Mistral
	 */
	async provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		messages: Array<LanguageModelChatMessage>,
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart>,
		token: CancellationToken
	): Promise<void> {
		// Check if client is initialized
		if (!this.client) {
			progress.report(new LanguageModelTextPart("Please add your Mistral API key to use Mistral AI."));
			return;
		}

		// Find the model in our list
		const foundModel = MISTRAL_MODELS.find(m => m.id === model.id);
		if (!foundModel) {
			progress.report(new LanguageModelTextPart(`Model ${model.id} not found.`));
			return;
		}

		// Convert VS Code messages to Mistral format
		const mistralMessages: MistralMessage[] = messages.map(msg => {
			const textContent: string[] = [];
			const toolCalls: MistralMessage['tool_calls'] = [];

			for (const part of msg.content) {
				if (part instanceof LanguageModelTextPart) {
					textContent.push(part.value);
				} else if (part instanceof LanguageModelToolCallPart) {
					toolCalls.push({
						id: part.callId,
						type: "function",
						function: {
							name: part.name,
							arguments: JSON.stringify(part.input)
						}
					});
				} else if (part instanceof LanguageModelToolResultPart) {
					// Tool results should be in tool messages
					const resultContent = part.content
						.filter(resultPart => resultPart instanceof LanguageModelTextPart)
						.map(resultPart => (resultPart as LanguageModelTextPart).value)
						.join('');

					return {
						role: "tool" as MistralRole,
						content: resultContent,
						tool_call_id: part.callId
					};
				}
			}

			const messageContent = textContent.join('');

			// Return message with tool calls if present
			if (toolCalls.length > 0) {
				return {
					role: "assistant" as MistralRole,
					content: messageContent || '',
					tool_calls: toolCalls
				};
			}

			return {
				role: toMistralRole(msg.role),
				content: messageContent
			};
		}).filter(msg => (msg.content !== null && msg.content.length > 0) || msg.role === "tool" || msg.tool_calls);

		// Convert VS Code tools to Mistral format
		const mistralTools = options.tools?.map(tool => ({
			type: "function" as const,
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema || {}
			}
		}));

		try {
			// Create chat completion request with streaming
			const stream = await this.client.chat.stream({
				model: model.id,
				messages: mistralMessages,
				maxTokens: foundModel.defaultCompletionTokens,
				temperature: foundModel.temperature ?? 0.7,
				topP: foundModel.top_p ?? undefined,
				tools: mistralTools && mistralTools.length > 0 && foundModel.toolCalling ? mistralTools : undefined
			});

			// Process streaming response
			for await (const event of stream) {
				// Check if the operation was cancelled
				if (token.isCancellationRequested) {
					break;
				}

				// Handle the streaming chunk
				const chunk = event.data;
				if (chunk.choices && chunk.choices.length > 0) {
					const choice = chunk.choices[0];
					const delta = choice.delta;

					// Handle text content
					if (delta?.content) {
						// delta.content can be string or ContentChunk[]
						const content = typeof delta.content === 'string' 
							? delta.content 
							: delta.content.map(c => 'text' in c ? c.text : '').join('');
						if (content) {
							progress.report(new LanguageModelTextPart(content));
						}
					}

					// Handle tool calls
					if (delta?.toolCalls) {
						for (const toolCall of delta.toolCalls) {
							if (toolCall.function?.name && toolCall.function?.arguments && toolCall.id) {
								try {
									// arguments can be string or object
									const parsedArgs = typeof toolCall.function.arguments === 'string'
										? JSON.parse(toolCall.function.arguments)
										: toolCall.function.arguments;
									progress.report(new LanguageModelToolCallPart(
										toolCall.id,
										toolCall.function.name,
										parsedArgs
									));
								} catch (e) {
									console.warn('Failed to parse tool call arguments:', e);
								}
							}
						}
					}
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
			progress.report(new LanguageModelTextPart(`Error: ${errorMessage}`));
		}
	}

	/**
	 * Provide token count for text or messages
	 */
	async provideTokenCount(
		_model: LanguageModelChatInformation,
		text: string | LanguageModelChatMessage,
		_token: CancellationToken
	): Promise<number> {
		if (!this.tokenizer) {
			this.tokenizer = get_encoding("cl100k_base");
		}

		let textContent = '';

		if (typeof text === 'string') {
			textContent = text;
		} else {
			// Extract text from message parts including tool calls and results
			textContent = text.content
				.map(part => {
					if (part instanceof LanguageModelTextPart) {
						return part.value;
					} else if (part instanceof LanguageModelToolCallPart) {
						// Count tokens for tool calls (name + JSON-serialized input)
						return part.name + JSON.stringify(part.input);
					} else if (part instanceof LanguageModelToolResultPart) {
						// Count tokens for tool results
						return part.content
							.filter(resultPart => resultPart instanceof LanguageModelTextPart)
							.map(resultPart => (resultPart as LanguageModelTextPart).value)
							.join('');
					}
					return '';
				})
				.join('');
		}

		const tokens = this.tokenizer.encode(textContent);
		this.tokenizer.free(); // Free associated memory
		return tokens.length;
	}
}

/**
 * Convert VS Code message role to Mistral role
 */
function toMistralRole(role: LanguageModelChatMessageRole): MistralRole {
	switch (role) {
		case LanguageModelChatMessageRole.User:
			return 'user';
		case LanguageModelChatMessageRole.Assistant:
			return 'assistant';
		default:
			return 'user';
	}
}
