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
     * Validate that the provider is properly configured
     */
    validateConfiguration(): boolean;
}

/**
 * Factory for creating LLM providers
 */
export class LLMProviderFactory {
    private static instances: Map<string, LLMProvider> = new Map();

    /**
     * Create or get the LLM provider for the specified type
     */
    static async getProvider(providerType: 'openai' | 'qwen' = 'openai', config?: LLMConfig): Promise<LLMProvider> {

        // Create a cache key based on provider type and config
        const cacheKey = `${providerType}-${JSON.stringify(config || {})}`;

        if (!this.instances.has(cacheKey)) {
            console.log(`📦 Creating new ${providerType} provider instance`);
            switch (providerType) {
                case 'openai':
                    const { OpenAIProvider } = await import('./openai-provider.js');
                    this.instances.set(cacheKey, new OpenAIProvider(config));
                    break;
                case 'qwen':
                    const { QwenProvider } = await import('./qwen-provider.js');
                    this.instances.set(cacheKey, new QwenProvider(config));
                    break;
                default:
                    throw new Error(`Unsupported LLM provider: ${providerType}`);
            }
        } else {
            console.log(`♻️  Reusing cached ${providerType} provider instance`);
        }
        return this.instances.get(cacheKey)!;
    }

    /**
     * Set a custom provider instance for a specific type
     */
    static setProvider(provider: LLMProvider, providerType: 'openai' | 'qwen' = 'openai', config?: LLMConfig): void {
        const cacheKey = `${providerType}-${JSON.stringify(config || {})}`;
        this.instances.set(cacheKey, provider);
    }

    /**
     * Reset all provider instances (clears the cache)
     */
    static reset(): void {
        this.instances.clear();
    }
}