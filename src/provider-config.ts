import { LLMConfig } from './llm/llm-provider';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

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
                apiKey: 'local'
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
            console.log('✅ Provider selected from environment: Qwen (local via Ollama)');
            return this.qwen(options);
        }

        console.log('✅ Provider selected from environment: OpenAI (default)');
        return this.openai(options);
    }
}
