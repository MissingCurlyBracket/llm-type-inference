import * as fs from 'fs';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';

dotenv.config();

export interface TypeInferenceResult {
    entity: 'function' | 'variable' | 'class' | 'class-method';
    name: string;
    location: {
        line: number;
        column: number;
    };
    types: {
        params?: { [paramName: string]: string };
        return: string;
    };
}

export class TypeInference {
    private openai: OpenAI;

    constructor() {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }

    async inferTypes(sourceCode: string): Promise<TypeInferenceResult[]> {
        const prompt = `You are a static type inference assistant. Given JavaScript code, infer precise TypeScript-style types.

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

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                max_tokens: 4000
            });

            const content = response.choices[0]?.message?.content?.trim();

            if (!content) {
                throw new Error('No response content from OpenAI');
            }

            // Try to parse the JSON response
            try {
                const parsed = JSON.parse(content);
                return this.validateResponse(parsed);
            } catch (parseError) {
                // If parsing fails, try to extract JSON from markdown blocks
                const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[1]);
                    return this.validateResponse(parsed);
                }
                throw new Error(`Failed to parse JSON response: ${content}`);
            }
        } catch (error) {
            throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : String(error)}`);
        }
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

    private validateResponse(data: any): TypeInferenceResult[] {
        if (!Array.isArray(data)) {
            throw new Error('Response must be an array');
        }

        return data.map((item, index) => {
            if (!item || typeof item !== 'object') {
                throw new Error(`Invalid item at index ${index}: must be an object`);
            }

            const { entity, name, location, types } = item;

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

            // Validate types
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
            // For variables and classes, params should not be included

            return {
                entity: entity as 'function' | 'variable' | 'class' | 'class-method',
                name,
                location: { line, column },
                types: {
                    ...(params !== undefined && { params }),
                    return: types.return
                }
            };
        });
    }
}