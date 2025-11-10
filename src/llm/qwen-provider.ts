import { Ollama } from 'ollama';
import * as dotenv from 'dotenv';
import { LLMProvider, LLMConfig, LLMResponse } from './llm-provider';

dotenv.config();

/**
 * Qwen (via Ollama) implementation of the LLM provider interface
 */
export class QwenProvider implements LLMProvider {
    private ollama: Ollama;
    private defaultConfig: Required<LLMConfig>;

    constructor(config?: LLMConfig) {
        // Ollama doesn't require an API key, but we keep the interface consistent
        const apiKey = config?.apiKey || process.env.OLLAMA_API_KEY || 'local';

        this.ollama = new Ollama({
            host: process.env.OLLAMA_HOST || 'http://localhost:11434'
        });

        this.defaultConfig = {
            model: config?.model || 'qwen3-coder:30b',
            temperature: config?.temperature ?? 0.1,
            maxTokens: config?.maxTokens || 4000,
            apiKey: apiKey
        };
    }

    async generateCompletion(prompt: string, config?: LLMConfig): Promise<LLMResponse> {
        const finalConfig = {
            ...this.defaultConfig,
            ...config
        };

        try {
            const response = await this.ollama.chat({
                model: finalConfig.model,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                options: {
                    temperature: finalConfig.temperature,
                    num_predict: finalConfig.maxTokens
                }
            });

            const content = response.message?.content?.trim();

            if (!content) {
                throw new Error('No response content from Ollama/Qwen');
            }

            return {
                content,
                usage: {
                    promptTokens: response.prompt_eval_count,
                    completionTokens: response.eval_count,
                    totalTokens: (response.prompt_eval_count || 0) + (response.eval_count || 0)
                }
            };
        } catch (error) {
            throw new Error(`Ollama API error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    validateConfiguration(): boolean {
        try {
            return Boolean(this.ollama);
        } catch {
            return false;
        }
    }
}
