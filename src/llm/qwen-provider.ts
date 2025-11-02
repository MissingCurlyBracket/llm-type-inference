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

    async generateMultipleCompletions(prompt: string, numCompletions: number = 5, config?: LLMConfig): Promise<LLMResponse> {
        const finalConfig = {
            ...this.defaultConfig,
            ...config,
            // Use higher temperature for diverse predictions
            temperature: config?.temperature ?? Math.max(0.3, this.defaultConfig.temperature)
        };

        // For multiple completions, we'll make a single call with higher temperature
        // The prompt should be designed to return multiple predictions
        return this.generateCompletion(prompt, finalConfig);
    }

    getProviderName(): string {
        return 'qwen';
    }

    validateConfiguration(): boolean {
        try {
            return Boolean(this.ollama);
        } catch {
            return false;
        }
    }

    /**
     * Get the current model being used
     */
    getCurrentModel(): string {
        return this.defaultConfig.model;
    }

    /**
     * Update the default configuration
     */
    updateConfig(config: Partial<LLMConfig>): void {
        this.defaultConfig = {
            ...this.defaultConfig,
            ...config
        };
    }

    /**
     * Parse JSON response from Qwen, handling markdown code blocks
     * (same logic as OpenAI provider for compatibility)
     */
    static parseJSONResponse(content: string): any {
        try {
            return JSON.parse(content);
        } catch (parseError) {
            // If parsing fails, try to extract JSON from markdown blocks
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1]);
            }
            throw new Error(`Failed to parse JSON response: ${content}`);
        }
    }
}
