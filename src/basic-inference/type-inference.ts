import * as fs from 'fs';
import { LLMProvider, LLMProviderFactory, LLMConfig } from '../llm/llm-provider';
import { OpenAIProvider } from '../llm/openai-provider';

export interface TypeInferenceResult {
    entity: 'function' | 'variable' | 'class' | 'class-method';
    name: string;
    location: {
        line: number;
        column: number;
    };
    types?: {
        params?: { [paramName: string]: string };
        return: string;
    };
    candidates?: Array<{
        types: {
            params?: { [paramName: string]: string };
            return: string;
        };
        confidence?: number;
    }>;
}

export class TypeInference {
    private llmProvider: LLMProvider;

    constructor(llmConfig?: LLMConfig) {
        this.llmProvider = LLMProviderFactory.getProvider('openai', llmConfig);

        if (!this.llmProvider.validateConfiguration()) {
            throw new Error('LLM provider configuration is invalid. Check your API key and settings.');
        }
    }

    async inferTypes(sourceCode: string): Promise<TypeInferenceResult[]> {
        return this.inferTypesWithMultiplePredictions(sourceCode, 1);
    }

    async inferTypesWithMultiplePredictions(sourceCode: string, numPredictions: number = 5): Promise<TypeInferenceResult[]> {
        const prompt = numPredictions === 1
            ? this.createSinglePredictionPrompt(sourceCode)
            : this.createMultiplePredictionPrompt(sourceCode, numPredictions);

        try {
            const response = numPredictions === 1
                ? await this.llmProvider.generateCompletion(prompt)
                : await this.llmProvider.generateMultipleCompletions(prompt, numPredictions);

            const content = response.content;

            // Try to parse the JSON response
            try {
                const parsed = OpenAIProvider.parseJSONResponse(content);
                return this.validateResponse(parsed, numPredictions > 1);
            } catch (parseError) {
                throw new Error(`Failed to parse JSON response: ${content}`);
            }
        } catch (error) {
            throw new Error(`LLM API error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private createSinglePredictionPrompt(sourceCode: string): string {
        return `You are a static type inference assistant. Given JavaScript code, infer precise TypeScript-style types.

Analyze the following JavaScript code:

\`\`\`javascript
${sourceCode}
\`\`\`

Respond only with a JSON array using this exact schema for each identifier found:
{
  "entity": "function|variable|class|class-method",
  "name": "identifier_name",
  "location": {
    "line": 1,
    "column": 0
  },
  "types": {
    "params": { "paramName": "type" },
    "return": "type"
  }
}

IMPORTANT EXTRACTION RULES:
1. Extract ALL identifiers including:
   - Top-level functions (entity: "function")
   - Variables and constants (entity: "variable")
   - Class declarations (entity: "class")
   - Class methods (entity: "class-method", name format: "ClassName.methodName")
   - Arrow functions assigned to variables (entity: "function")

2. For location field:
   - Estimate line numbers by counting lines in the source code
   - Use column 0 if exact position is unknown
   - ALWAYS include location object with line and column numbers

3. For types object:
   - ALWAYS include "return" field
   - For functions and class-methods: include "params" object (can be empty {})
   - For variables and classes: omit "params" field entirely
   - Example for function: "types": {"params": {"a": "number", "b": "number"}, "return": "number"}
   - Example for variable: "types": {"return": "string"}
   - Example for class: "types": {"return": "ClassName"}

4. TYPE INFERENCE RULES:
   - Use specific TypeScript types: string, number, boolean, array, function, null, undefined, void
   - For object types, prefer interface/class names if defined in the code
   - For arrays, use "type[]" notation
   - For class instances, use the class name as the type
   - For class methods, use entity "class-method" and format name as "ClassName.methodName"

5. REQUIRED JSON STRUCTURE:
   - Every item MUST have: entity, name, location, types
   - location MUST have: line (number), column (number)
   - types MUST have: return (string)
   - types MAY have: params (object) - only for functions and class-methods

Return only the JSON array, no markdown formatting or explanations.`;
    }

    private createMultiplePredictionPrompt(sourceCode: string, numPredictions: number): string {
        return `You are a static type inference assistant. Given JavaScript code, provide multiple ranked type predictions with confidence scores.

Analyze the following JavaScript code:

\`\`\`javascript
${sourceCode}
\`\`\`

For each identifier, provide ${numPredictions} ranked type predictions. Respond with a JSON array using this schema:
{
  "entity": "function|variable|class|class-method",
  "name": "identifier_name",
  "location": {
    "line": 1,
    "column": 0
  },
  "candidates": [
    {
      "types": {
        "params": { "paramName": "type" },
        "return": "type"
      },
      "confidence": 0.9
    },
    {
      "types": {
        "params": { "paramName": "alternative_type" },
        "return": "alternative_type"
      },
      "confidence": 0.7
    }
  ]
}

IMPORTANT RULES:
1. Extract ALL identifiers (functions, variables, classes, class methods)
2. Provide exactly ${numPredictions} candidates per identifier, ordered by confidence (highest first)
3. Confidence scores should be between 0.0 and 1.0
4. Each candidate must have "types" and "confidence" fields
5. For functions/class-methods: include "params" in types
6. For variables/classes: omit "params" from types
7. Use specific TypeScript types (string, number, boolean, etc.)

Return only the JSON array, no explanations.`;
    }

    async inferTypesFromFile(filePath: string): Promise<TypeInferenceResult[]> {
        try {
            const sourceCode = fs.readFileSync(filePath, 'utf8');
            return await this.inferTypes(sourceCode);
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                throw new Error(`File not found: ${filePath}`);
            }
            throw error;
        }
    }

    private validateResponse(data: any, isMultiPrediction: boolean = false): TypeInferenceResult[] {
        if (!Array.isArray(data)) {
            throw new Error('Response must be an array');
        }

        return data.map((item, index) => {
            if (!item || typeof item !== 'object') {
                throw new Error(`Invalid item at index ${index}: must be an object`);
            }

            const { entity, name, location, types, candidates } = item;

            // Validate entity
            if (!['function', 'variable', 'class', 'class-method'].includes(entity)) {
                throw new Error(`Invalid entity at index ${index}: must be 'function', 'variable', 'class', or 'class-method'`);
            }

            // Validate name
            if (typeof name !== 'string') {
                throw new Error(`Invalid name at index ${index}: must be a string`);
            }

            // Validate location (more lenient)
            if (!location || typeof location !== 'object') {
                throw new Error(`Invalid location at index ${index}: must be an object`);
            }

            const line = typeof location.line === 'number' ? location.line : 1;
            const column = typeof location.column === 'number' ? location.column : 0;

            const result: TypeInferenceResult = {
                entity: entity as 'function' | 'variable' | 'class' | 'class-method',
                name,
                location: { line, column }
            };

            if (isMultiPrediction && candidates) {
                // Validate candidates for multi-prediction
                if (!Array.isArray(candidates)) {
                    throw new Error(`Invalid candidates at index ${index}: must be an array`);
                }

                result.candidates = candidates.map((candidate, candIndex) => {
                    if (!candidate || typeof candidate !== 'object') {
                        throw new Error(`Invalid candidate at index ${index}, candidate ${candIndex}: must be an object`);
                    }

                    if (!candidate.types || typeof candidate.types !== 'object') {
                        throw new Error(`Invalid candidate types at index ${index}, candidate ${candIndex}: must be an object`);
                    }

                    if (typeof candidate.types.return !== 'string') {
                        throw new Error(`Invalid candidate return type at index ${index}, candidate ${candIndex}: must be a string`);
                    }

                    // Validate params based on entity type
                    let params: { [key: string]: string } | undefined;
                    if (entity === 'function' || entity === 'class-method') {
                        if (candidate.types.params && typeof candidate.types.params === 'object') {
                            params = candidate.types.params;
                        } else {
                            params = {}; // Default to empty params for functions
                        }
                    }

                    return {
                        types: {
                            ...(params !== undefined && { params }),
                            return: candidate.types.return
                        },
                        confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 1.0
                    };
                });
            } else {
                // Single prediction case
                if (!types || typeof types !== 'object') {
                    throw new Error(`Invalid types at index ${index}: must be an object`);
                }

                if (typeof types.return !== 'string') {
                    throw new Error(`Invalid return type at index ${index}: must be a string`);
                }

                // Validate params based on entity type
                let params: { [key: string]: string } | undefined;
                if (entity === 'function' || entity === 'class-method') {
                    if (types.params && typeof types.params === 'object') {
                        params = types.params;
                    } else {
                        params = {}; // Default to empty params for functions
                    }
                }

                result.types = {
                    ...(params !== undefined && { params }),
                    return: types.return
                };
            }

            return result;
        });
    }
}