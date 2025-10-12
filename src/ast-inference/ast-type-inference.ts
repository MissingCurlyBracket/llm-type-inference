import * as fs from 'fs';
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';

dotenv.config();

export interface TypeInferenceResult {
  entity: 'function' | 'variable' | 'class';
  name: string;
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

        nodes.push({
          type: 'ClassDeclaration',
          name: node.id.name,
          body: JSON.stringify(methods),
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
    
    if (t.isStringLiteral(init)) return `"${init.value}"`;
    if (t.isNumericLiteral(init)) return String(init.value);
    if (t.isBooleanLiteral(init)) return String(init.value);
    if (t.isNullLiteral(init)) return 'null';
    if (t.isArrayExpression(init)) return `[${init.elements.length} elements]`;
    if (t.isObjectExpression(init)) return `{${init.properties.length} properties}`;
    if (t.isFunctionExpression(init)) return 'function';
    if (t.isArrowFunctionExpression(init)) return 'arrow function';
    
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

    const prompt = `You are a static type inference assistant. Given an AST (Abstract Syntax Tree) representation of JavaScript code, infer precise TypeScript-style types.

Analyze the following AST nodes extracted from JavaScript code:

\`\`\`json
${JSON.stringify(astSummary, null, 2)}
\`\`\`

Based on the AST structure, parameter names, initialization values, and function bodies, infer the most appropriate TypeScript types.

Respond only with a JSON array using this exact schema for each identifier found:
{
  "entity": "function|variable|class",
  "name": "identifier_name",
  "types": {
    "params": { "paramName": "type" },
    "return": "type"
  }
}

For variables, only use the "return" field in types. For functions, use both "params" and "return".
Use specific TypeScript types like: string, number, boolean, object, array, function, null, undefined.

Consider the AST context:
- FunctionDeclaration/ArrowFunction nodes should be typed as functions
- VariableDeclaration nodes should be typed based on their initialization
- ClassDeclaration nodes should be typed as classes
- Infer parameter types from usage patterns and body analysis
- Infer return types from return statements and body analysis

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

      const { entity, name, types } = item;

      if (!['function', 'variable', 'class'].includes(entity)) {
        throw new Error(`Invalid entity at index ${index}: must be 'function', 'variable', or 'class'`);
      }

      if (typeof name !== 'string') {
        throw new Error(`Invalid name at index ${index}: must be a string`);
      }

      if (!types || typeof types !== 'object') {
        throw new Error(`Invalid types at index ${index}: must be an object`);
      }

      if (typeof types.return !== 'string') {
        throw new Error(`Invalid return type at index ${index}: must be a string`);
      }

      return {
        entity: entity as 'function' | 'variable' | 'class',
        name,
        types: {
          ...(types.params && { params: types.params }),
          return: types.return
        }
      };
    });
  }
}