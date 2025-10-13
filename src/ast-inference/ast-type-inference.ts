import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import * as t from '@babel/types';
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

interface ASTNode {
  type: string;
  name: string;
  params?: string[];
  body?: string;
  init?: string;
  location: {
    line: number;
    column: number;
  };
}

export class ASTTypeInference {
  private openai: OpenAI;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  private parseSourceToAST(sourceCode: string): t.File {
    try {
      return parse(sourceCode, {
        sourceType: 'module',
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        plugins: [
          'jsx',
          'typescript',
          'decorators-legacy',
          'classProperties',
          'asyncGenerators',
          'functionBind',
          'exportDefaultFrom',
          'exportNamespaceFrom',
          'dynamicImport',
          'nullishCoalescingOperator',
          'optionalChaining'
        ]
      });
    } catch (error) {
      throw new Error(`Failed to parse JavaScript code: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private extractRelevantNodes(ast: t.File): ASTNode[] {
    const nodes: ASTNode[] = [];

    const traverse = (node: any, parent?: any) => {
      if (!node || typeof node !== 'object') return;

      // Extract function declarations
      if (t.isFunctionDeclaration(node) && node.id) {
        nodes.push({
          type: 'FunctionDeclaration',
          name: node.id.name,
          params: node.params.map(param => {
            if (t.isIdentifier(param)) return param.name;
            if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) return param.left.name;
            return 'unknown';
          }),
          body: this.extractBodySummary(node.body),
          location: {
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column || 0
          }
        });
      }

      // Extract arrow functions assigned to variables
      if (t.isVariableDeclarator(node) && t.isArrowFunctionExpression(node.init) && t.isIdentifier(node.id)) {
        nodes.push({
          type: 'ArrowFunction',
          name: node.id.name,
          params: node.init.params.map(param => {
            if (t.isIdentifier(param)) return param.name;
            if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) return param.left.name;
            return 'unknown';
          }),
          body: this.extractBodySummary(node.init.body),
          location: {
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column || 0
          }
        });
      }

      // Extract variable declarations
      if (t.isVariableDeclarator(node) && t.isIdentifier(node.id) && !t.isArrowFunctionExpression(node.init)) {
        nodes.push({
          type: 'VariableDeclaration',
          name: node.id.name,
          init: this.extractInitializerSummary(node.init),
          location: {
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column || 0
          }
        });
      }

      // Extract class declarations
      if (t.isClassDeclaration(node) && node.id) {
        const methods = node.body.body
          .filter(member => t.isClassMethod(member) && t.isIdentifier(member.key))
          .map(method => {
            const methodNode = method as t.ClassMethod;
            return {
              name: (methodNode.key as t.Identifier).name,
              params: methodNode.params.map(param => {
                if (t.isIdentifier(param)) return param.name;
                return 'unknown';
              }),
              kind: methodNode.kind
            };
          });

        const properties = node.body.body
          .filter((member: any) => member.type === 'ClassProperty' && t.isIdentifier(member.key))
          .map((prop: any) => {
            return (prop.key as t.Identifier).name;
          });

        nodes.push({
          type: 'ClassDeclaration',
          name: node.id.name,
          body: `class_info:{methods: ${JSON.stringify(methods)}, properties: ${JSON.stringify(properties)}}`,
          location: {
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column || 0
          }
        });
      }

      // Recursively traverse child nodes
      for (const key in node) {
        if (key === 'parent' || key === 'loc' || key === 'range') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(item => traverse(item, node));
        } else if (child && typeof child === 'object') {
          traverse(child, node);
        }
      }
    };

    traverse(ast);
    return nodes;
  }

  private extractBodySummary(body: any): string {
    if (!body) return 'undefined';

    if (t.isBlockStatement(body)) {
      return `{ ${body.body.length} statements }`;
    }

    if (t.isExpression(body)) {
      return this.extractExpressionSummary(body);
    }

    return 'unknown';
  }

  private extractInitializerSummary(init: any): string {
    if (!init) return 'undefined';

    if (t.isStringLiteral(init)) return `string_literal:"${init.value}"`;
    if (t.isNumericLiteral(init)) return `number_literal:${init.value}`;
    if (t.isBooleanLiteral(init)) return `boolean_literal:${init.value}`;
    if (t.isNullLiteral(init)) return 'null_literal';
    if (t.isArrayExpression(init)) {
      // Try to determine array element types
      const elementTypes = init.elements
        .filter((el: any) => el !== null)
        .map((el: any) => {
          if (t.isStringLiteral(el)) return 'string';
          if (t.isNumericLiteral(el)) return 'number';
          if (t.isBooleanLiteral(el)) return 'boolean';
          return 'unknown';
        });
      const uniqueTypes = [...new Set(elementTypes)];
      return `array_literal:[${init.elements.length} elements, types: ${uniqueTypes.join('|')}]`;
    }
    if (t.isObjectExpression(init)) {
      // Extract object property types
      const properties = init.properties
        .filter((prop: any) => t.isObjectProperty(prop) && t.isIdentifier(prop.key))
        .map((prop: any) => {
          const key = prop.key.name;
          let valueType = 'unknown';
          if (t.isStringLiteral(prop.value)) valueType = 'string';
          else if (t.isNumericLiteral(prop.value)) valueType = 'number';
          else if (t.isBooleanLiteral(prop.value)) valueType = 'boolean';
          return `${key}: ${valueType}`;
        });
      return `object_literal:{${properties.join(', ')}}`;
    }
    if (t.isFunctionExpression(init)) return 'function_expression';
    if (t.isArrowFunctionExpression(init)) return 'arrow_function_expression';
    if (t.isNewExpression(init) && t.isIdentifier(init.callee)) {
      return `new_${init.callee.name}()`;
    }

    return 'unknown';
  }

  private extractExpressionSummary(expr: any): string {
    if (t.isBinaryExpression(expr)) return `binary operation (${expr.operator})`;
    if (t.isCallExpression(expr)) return 'function call';
    if (t.isIdentifier(expr)) return `identifier: ${expr.name}`;
    if (t.isLiteral(expr)) return 'literal value';

    return 'expression';
  }

  async inferTypes(sourceCode: string): Promise<TypeInferenceResult[]> {
    // Parse source code to AST
    const ast = this.parseSourceToAST(sourceCode);

    // Extract relevant nodes
    const nodes = this.extractRelevantNodes(ast);

    // Create structured representation for the LLM
    const astSummary = nodes.map(node => ({
      type: node.type,
      name: node.name,
      params: node.params,
      body: node.body,
      init: node.init,
      location: node.location
    }));

    // Write AST to file for debugging
    const astOutputPath = path.join(process.cwd(), 'ast-infer', 'ast.json');
    const astDebugData = {
      extractedNodes: astSummary,
    };

    try {
      fs.writeFileSync(astOutputPath, JSON.stringify(astDebugData, null, 2));
      console.log(`AST written to: ${astOutputPath}`);
    } catch (error) {
      console.warn(`Failed to write AST file: ${error instanceof Error ? error.message : String(error)}`);
    }

    const prompt = `You are a static type inference assistant. Given an AST (Abstract Syntax Tree) representation of JavaScript code, infer precise TypeScript-style types.

Analyze the following AST nodes extracted from JavaScript code:

\`\`\`json
${JSON.stringify(astSummary, null, 2)}
\`\`\`

Based on the AST structure, parameter names, initialization values, and function bodies, infer the most appropriate TypeScript types.

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

CRITICAL EXTRACTION REQUIREMENTS:
1. MUST include ALL nodes from the AST analysis above
2. Use correct entity types:
   - FunctionDeclaration nodes → entity: "function"
   - VariableDeclaration nodes → entity: "variable"  
   - ClassDeclaration nodes → entity: "class"
   - ClassMethod nodes → entity: "class-method"

3. For ClassMethod nodes:
   - MUST use entity: "class-method"
   - Keep the full "ClassName.methodName" format as name
   - Include both params and return types

4. TYPE INFERENCE RULES:
   - Use specific TypeScript types: string, number, boolean, array, function, void, null, undefined
   - For object types, prefer interface/class names if they exist in the code
   - For arrays, use "type[]" notation
   - For class instances, use the class name as the type
   - Consider identifier names for context clues to what the type might be


5. Analyze initialization values and function bodies for accurate type inference:
   - String literals → "string"
   - Number literals → "number" 
   - Boolean literals → "boolean"
   - Array expressions → appropriate array type (e.g., "string[]", "number[]")
   - Object expressions → object type or interface name if available
   - Class constructors → class name

4. TYPES OBJECT RULES:
   - For classes: use "return": "ClassName" (the class name itself)
   - For variables: only use the "return" field in types
   - For functions and class-methods: use both "params" and "return"

NEVER return "undefined" as a type unless the value is explicitly undefined. Analyze the initialization values and usage patterns carefully.

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