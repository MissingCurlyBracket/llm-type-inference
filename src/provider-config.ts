import { LLMConfig } from './llm/llm-provider';

/**
 * Helper to create provider configurations
 */
export class ProviderConfig {
    /**
     * Get OpenAI configuration
     */
    static openai(options?: Partial<LLMConfig>): { config: LLMConfig, provider: 'openai' } {
        return {
            config: {
                model: options?.model || 'gpt-4',
                temperature: options?.temperature ?? 0.1,
                maxTokens: options?.maxTokens || 4000,
                apiKey: options?.apiKey || process.env.OPENAI_API_KEY
            },
            provider: 'openai'
        };
    }

    /**
     * Get Qwen configuration
     */
    static qwen(options?: Partial<LLMConfig>): { config: LLMConfig, provider: 'qwen' } {
        return {
            config: {
                model: options?.model || 'qwen3-coder:30b',
                temperature: options?.temperature ?? 0.1,
                maxTokens: options?.maxTokens || 4000,
                apiKey: 'local' // Ollama doesn't need an API key
            },
            provider: 'qwen'
        };
    }

    /**
     * Get configuration based on environment variable
     * Set LLM_PROVIDER=qwen or LLM_PROVIDER=openai in .env
     */
    static fromEnv(options?: Partial<LLMConfig>): { config: LLMConfig, provider: 'openai' | 'qwen' } {
        const provider = process.env.LLM_PROVIDER?.toLowerCase();

        if (provider === 'qwen') {
            return this.qwen(options);
        }

        return this.openai(options);
    }
}

/**
 * Example usage:
 * 
 * import { TypeInference } from './basic-inference/type-inference';
 * import { ProviderConfig } from './provider-config';
 * 
 * // Using OpenAI
 * const { config, provider } = ProviderConfig.openai();
 * const inference = new TypeInference(config, provider);
 * 
 * // Using Qwen
 * const { config, provider } = ProviderConfig.qwen();
 * const inference = new TypeInference(config, provider);
 * 
 * // Using environment variable
 * const { config, provider } = ProviderConfig.fromEnv();
 * const inference = new TypeInference(config, provider);
 * 
 * // With custom options
 * const { config, provider } = ProviderConfig.qwen({ temperature: 0.3 });
 * const inference = new TypeInference(config, provider);
 */
