/**
 * Configuration options for LLM inference
 */
export interface LLMConfig {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    apiKey?: string;
}

/**
 * Response from LLM inference
 */
export interface LLMResponse {
    content: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
}

/**
 * Abstract interface for LLM providers
 * Allows switching between different LLM providers (OpenAI, Anthropic, etc.)
 */
export interface LLMProvider {
    /**
     * Generate a single response from the LLM
     */
    generateCompletion(prompt: string, config?: LLMConfig): Promise<LLMResponse>;
    
    /**
     * Generate multiple responses with potentially higher temperature
     * for diverse predictions
     */
    generateMultipleCompletions(prompt: string, numCompletions?: number, config?: LLMConfig): Promise<LLMResponse>;
    
    /**
     * Get the provider name (e.g., "openai", "anthropic")
     */
    getProviderName(): string;
    
    /**
     * Validate that the provider is properly configured
     */
    validateConfiguration(): boolean;
}

/**
 * Factory for creating LLM providers
 */
export class LLMProviderFactory {
    private static instance?: LLMProvider;
    
    /**
     * Create or get the default LLM provider
     */
    static getProvider(providerType: 'openai' | 'qwen' = 'openai', config?: LLMConfig): LLMProvider {
        if (!this.instance) {
            switch (providerType) {
                case 'openai':
                    const { OpenAIProvider } = require('./openai-provider');
                    this.instance = new OpenAIProvider(config);
                    break;
                case 'qwen':
                    const { QwenProvider } = require('./qwen-provider');
                    this.instance = new QwenProvider(config);
                    break;
                default:
                    throw new Error(`Unsupported LLM provider: ${providerType}`);
            }
        }
        return this.instance!;
    }
    
    /**
     * Set a custom provider instance
     */
    static setProvider(provider: LLMProvider): void {
        this.instance = provider;
    }
    
    /**
     * Reset the provider instance
     */
    static reset(): void {
        this.instance = undefined;
    }
}