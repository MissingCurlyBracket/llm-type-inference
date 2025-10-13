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
    "line": line_number,
    "column": column_number
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

2. For class methods, you MUST:
   - Use entity type "class-method" 
   - Format name as "ClassName.methodName" (e.g., "Calculator.add")
   - Include both params and return types

3. TYPE INFERENCE RULES:
   - Use specific TypeScript types: string, number, boolean, array, function, null, undefined, void
   - For object types, prefer interface/class names if defined in the code
   - For arrays, use "type[]" notation
   - For class instances, use the class name as the type
   - Consider identifier names for context clues to what the type might be

4. TYPES OBJECT RULES:
   - For classes: use "return": "ClassName" (the class name itself)
   - For variables: only use the "return" field in types
   - For functions and class-methods: use both "params" and "return"

Return only the JSON array, no markdown formatting or explanations.`;

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                max_tokens: 2000
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

            if (!['function', 'variable', 'class', 'class-method'].includes(entity)) {
                throw new Error(`Invalid entity at index ${index}: must be 'function', 'variable', 'class', or 'class-method'`);
            }

            if (typeof name !== 'string') {
                throw new Error(`Invalid name at index ${index}: must be a string`);
            }

            if (!location || typeof location !== 'object' ||
                typeof location.line !== 'number' || typeof location.column !== 'number') {
                throw new Error(`Invalid location at index ${index}: must be an object with line and column numbers`);
            }

            if (!types || typeof types !== 'object') {
                throw new Error(`Invalid types at index ${index}: must be an object`);
            }

            if (typeof types.return !== 'string') {
                throw new Error(`Invalid return type at index ${index}: must be a string`);
            }

            return {
                entity: entity as 'function' | 'variable' | 'class' | 'class-method',
                name,
                location: {
                    line: location.line,
                    column: location.column
                },
                types: {
                    ...(types.params && { params: types.params }),
                    return: types.return
                }
            };
        });
    }
}