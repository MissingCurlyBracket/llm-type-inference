import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { LLMProvider, LLMConfig, LLMResponse } from './llm-provider';

dotenv.config();

/**
 * OpenAI implementation of the LLM provider interface
 */
export class OpenAIProvider implements LLMProvider {
    private openai: OpenAI;
    private defaultConfig: Required<LLMConfig>;

    constructor(config?: LLMConfig) {
        const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
        
        if (!apiKey) {
            throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass apiKey in config.');
        }

        this.openai = new OpenAI({
            apiKey: apiKey
        });

        this.defaultConfig = {
            model: config?.model || 'gpt-4',
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
            const response = await this.openai.chat.completions.create({
                model: finalConfig.model,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: finalConfig.temperature,
                max_tokens: finalConfig.maxTokens
            });

            const content = response.choices[0]?.message?.content?.trim();

            if (!content) {
                throw new Error('No response content from OpenAI');
            }

            return {
                content,
                usage: {
                    promptTokens: response.usage?.prompt_tokens,
                    completionTokens: response.usage?.completion_tokens,
                    totalTokens: response.usage?.total_tokens
                }
            };
        } catch (error) {
            throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : String(error)}`);
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
        return 'openai';
    }

    validateConfiguration(): boolean {
        try {
            return Boolean(this.defaultConfig.apiKey && this.openai);
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
     * Parse JSON response from OpenAI, handling markdown code blocks
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