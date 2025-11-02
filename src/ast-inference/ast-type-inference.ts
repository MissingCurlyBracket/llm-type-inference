import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { LLMProvider, LLMProviderFactory, LLMConfig } from '../llm/llm-provider';
import { OpenAIProvider } from '../llm/openai-provider';

export interface TypeInferenceResult {
  entity: 'function' | 'variable' | 'class' | 'class-method';
  name: string;
  location: {
    line: number;
    column: number;
  };
  types: {
    params?: { [paramName: string]: string };
    return: string[];
  };
}

export interface TypeInferenceResponse {
    results: TypeInferenceResult[];
    promptTokens: number;
}

interface ASTNode {
  type: string;
  name: string;
  params?: Array<{
    name: string;
    defaultValue?: string;
    usagePatterns?: string[];
  }>;
  body?: {
    summary: string;
    returnStatements?: string[];
    variableUsage?: { [varName: string]: string[] };
    functionCalls?: string[];
    typeHints?: string[];
    controlFlow?: string[];
  };
  init?: {
    type: string;
    value?: any;
    inferredType: string;
  };
  location: {
    line: number;
    column: number;
  };
}

export class ASTTypeInference {
  private llmProvider: LLMProvider;

  constructor(llmConfig?: LLMConfig) {
    if (llmConfig) {
      this.llmProvider = LLMProviderFactory.getProvider('openai', llmConfig);
    } else {
      // Default to OpenAI
      this.llmProvider = new OpenAIProvider();
    }
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
          params: node.params.map(param => this.analyzeParameter(param, node.body)),
          body: this.analyzeBlockStatement(node.body),
          location: {
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column || 0
          }
        });
      }

      // Extract arrow functions assigned to variables
      if (t.isVariableDeclarator(node) && node.init && t.isArrowFunctionExpression(node.init) && t.isIdentifier(node.id)) {
        const arrowFunc = node.init as t.ArrowFunctionExpression; // Type assertion

        nodes.push({
          type: 'ArrowFunction',
          name: node.id.name,
          params: arrowFunc.params.map(param => this.analyzeParameter(param, arrowFunc.body)),
          body: t.isBlockStatement(arrowFunc.body)
            ? this.analyzeBlockStatement(arrowFunc.body)
            : this.analyzeExpression(arrowFunc.body),
          location: {
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column || 0
          }
        });
      }

      // Extract variable declarations
      if (t.isVariableDeclarator(node) && t.isIdentifier(node.id) && node.init && !t.isArrowFunctionExpression(node.init)) {
        nodes.push({
          type: 'VariableDeclaration',
          name: node.id.name,
          init: this.analyzeInitializer(node.init),
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
          body: {
            summary: `class with ${node.body.body.length} members`,
            typeHints: [`class ${node.id.name}`, `methods: ${methods.map(m => m.name).join(', ')}`],
            functionCalls: [],
            variableUsage: {},
            returnStatements: [],
            controlFlow: []
          },
          location: {
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column || 0
          }
        });

        // Add class methods as separate nodes
        node.body.body.forEach((member: any) => {
          if (t.isClassMethod(member) && t.isIdentifier(member.key) && node.id) {
            const methodName = `${node.id.name}.${member.key.name}`;
            nodes.push({
              type: 'ClassMethod',
              name: methodName,
              params: member.params.map(param => this.analyzeParameter(param, member.body)),
              body: this.analyzeBlockStatement(member.body),
              location: {
                line: member.loc?.start.line || 0,
                column: member.loc?.start.column || 0
              }
            });
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

  private analyzeParameter(param: any, functionBody: any): {
    name: string;
    defaultValue?: string;
    usagePatterns?: string[];
  } {
    const result: any = { name: 'unknown' };

    if (t.isIdentifier(param)) {
      result.name = param.name;
      result.usagePatterns = this.findParameterUsage(param.name, functionBody);
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      result.name = param.left.name;
      result.defaultValue = this.extractValueFromNode(param.right);
      result.usagePatterns = this.findParameterUsage(param.left.name, functionBody);
    }

    return result;
  }

  private analyzeBlockStatement(body: any): {
    summary: string;
    returnStatements?: string[];
    variableUsage?: { [varName: string]: string[] };
    functionCalls?: string[];
    typeHints?: string[];
    controlFlow?: string[];
  } {
    if (!body || !t.isBlockStatement(body)) {
      return { summary: 'unknown' };
    }

    const result = {
      summary: `{ ${body.body.length} statements }`,
      returnStatements: [] as string[],
      variableUsage: {} as { [varName: string]: string[] },
      functionCalls: [] as string[],
      typeHints: [] as string[],
      controlFlow: [] as string[]
    };

    // Analyze each statement in the function body
    body.body.forEach((statement: any) => {
      this.analyzeStatement(statement, result);
    });

    return result;
  }

  private analyzeExpression(expr: any): {
    summary: string;
    returnStatements?: string[];
    variableUsage?: { [varName: string]: string[] };
    functionCalls?: string[];
    typeHints?: string[];
    controlFlow?: string[];
  } {
    const result = {
      summary: 'expression',
      returnStatements: [] as string[],
      variableUsage: {} as { [varName: string]: string[] },
      functionCalls: [] as string[],
      typeHints: [] as string[],
      controlFlow: [] as string[]
    };

    if (t.isBinaryExpression(expr)) {
      result.summary = `binary operation (${expr.operator})`;
      result.typeHints.push(this.inferTypeFromBinaryOp(expr.operator));
    } else if (t.isCallExpression(expr)) {
      result.summary = 'function call expression';
      if (t.isIdentifier(expr.callee)) {
        result.functionCalls.push(expr.callee.name);
      } else if (t.isMemberExpression(expr.callee) && t.isIdentifier(expr.callee.property)) {
        result.functionCalls.push(`method: ${expr.callee.property.name}`);
      }
    } else if (t.isStringLiteral(expr)) {
      result.summary = 'string literal';
      result.typeHints.push('string');
    } else if (t.isNumericLiteral(expr)) {
      result.summary = 'numeric literal';
      result.typeHints.push('number');
    } else if (t.isBooleanLiteral(expr)) {
      result.summary = 'boolean literal';
      result.typeHints.push('boolean');
    } else if (t.isArrayExpression(expr)) {
      result.summary = 'array expression';
      result.typeHints.push('array');
    } else if (t.isObjectExpression(expr)) {
      result.summary = 'object expression';
      result.typeHints.push('object');
    }

    return result;
  }

  private analyzeStatement(statement: any, result: any): void {
    if (t.isReturnStatement(statement)) {
      if (statement.argument) {
        const returnValue = this.extractValueFromNode(statement.argument);
        result.returnStatements.push(returnValue);

        // Infer type from return value
        if (t.isStringLiteral(statement.argument)) {
          result.typeHints.push('returns string');
        } else if (t.isNumericLiteral(statement.argument)) {
          result.typeHints.push('returns number');
        } else if (t.isBooleanLiteral(statement.argument)) {
          result.typeHints.push('returns boolean');
        } else if (t.isArrayExpression(statement.argument)) {
          result.typeHints.push('returns array');
        } else if (t.isObjectExpression(statement.argument)) {
          result.typeHints.push('returns object');
        } else if (t.isCallExpression(statement.argument)) {
          result.typeHints.push('returns function call result');
        } else if (t.isBinaryExpression(statement.argument)) {
          result.typeHints.push(`returns ${this.inferTypeFromBinaryOp(statement.argument.operator)}`);
        }
      } else {
        result.returnStatements.push('undefined');
        result.typeHints.push('returns void');
      }
    } else if (t.isVariableDeclaration(statement)) {
      statement.declarations.forEach((decl: any) => {
        if (t.isIdentifier(decl.id) && decl.init) {
          const varName = decl.id.name;
          const initValue = this.extractValueFromNode(decl.init);
          if (!result.variableUsage[varName]) {
            result.variableUsage[varName] = [];
          }
          result.variableUsage[varName].push(`initialized with: ${initValue}`);
        }
      });
    } else if (t.isExpressionStatement(statement)) {
      this.analyzeExpressionForUsage(statement.expression, result);
    } else if (t.isIfStatement(statement)) {
      result.controlFlow.push('if statement');
      if (statement.consequent) this.analyzeStatement(statement.consequent, result);
      if (statement.alternate) this.analyzeStatement(statement.alternate, result);
    } else if (t.isForStatement(statement) || t.isWhileStatement(statement)) {
      result.controlFlow.push('loop');
    }
  }

  private analyzeExpressionForUsage(expr: any, result: any): void {
    if (t.isCallExpression(expr)) {
      if (t.isIdentifier(expr.callee)) {
        result.functionCalls.push(expr.callee.name);
      } else if (t.isMemberExpression(expr.callee) && t.isIdentifier(expr.callee.property)) {
        result.functionCalls.push(`method: ${expr.callee.property.name}`);
      }
    } else if (t.isAssignmentExpression(expr)) {
      if (t.isIdentifier(expr.left)) {
        const varName = expr.left.name;
        const assignedValue = this.extractValueFromNode(expr.right);
        if (!result.variableUsage[varName]) {
          result.variableUsage[varName] = [];
        }
        result.variableUsage[varName].push(`assigned: ${assignedValue}`);
      }
    }
  }

  private findParameterUsage(paramName: string, body: any): string[] {
    const usages: string[] = [];

    const findUsageInNode = (node: any) => {
      if (!node || typeof node !== 'object') return;

      if (t.isIdentifier(node) && node.name === paramName) {
        usages.push('referenced');
      } else if (t.isMemberExpression(node) && t.isIdentifier(node.object) && node.object.name === paramName) {
        if (t.isIdentifier(node.property)) {
          usages.push(`property access: ${node.property.name}`);
        }
      } else if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === paramName) {
        usages.push('called as function');
      } else if (t.isCallExpression(node) && t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.object) && node.callee.object.name === paramName) {
        if (t.isIdentifier(node.callee.property)) {
          usages.push(`method call: ${node.callee.property.name}`);
        }
      }

      // Recursively search in child nodes
      for (const key in node) {
        if (key !== 'parent' && node[key]) {
          if (Array.isArray(node[key])) {
            node[key].forEach(findUsageInNode);
          } else if (typeof node[key] === 'object') {
            findUsageInNode(node[key]);
          }
        }
      }
    };

    findUsageInNode(body);
    return [...new Set(usages)]; // Remove duplicates
  }

  private extractValueFromNode(node: any): string {
    if (!node) return 'undefined';
    if (t.isStringLiteral(node)) return `"${node.value}"`;
    if (t.isNumericLiteral(node)) return String(node.value);
    if (t.isBooleanLiteral(node)) return String(node.value);
    if (t.isNullLiteral(node)) return 'null';
    if (t.isIdentifier(node)) return node.name;
    if (t.isBinaryExpression(node)) return `${this.extractValueFromNode(node.left)} ${node.operator} ${this.extractValueFromNode(node.right)}`;
    if (t.isCallExpression(node) && t.isIdentifier(node.callee)) return `${node.callee.name}()`;
    if (t.isMemberExpression(node) && t.isIdentifier(node.property)) return `${this.extractValueFromNode(node.object)}.${node.property.name}`;
    return 'expression';
  }

  private inferTypeFromBinaryOp(operator: string): string {
    if (['+', '-', '*', '/', '%', '**'].includes(operator)) return 'number';
    if (['==', '===', '!=', '!==', '<', '>', '<=', '>='].includes(operator)) return 'boolean';
    if (operator === '+') return 'string or number'; // Could be concatenation
    return 'unknown';
  }

  private analyzeInitializer(init: any): {
    type: string;
    value?: any;
    inferredType: string;
  } {
    if (!init) return { type: 'undefined', inferredType: 'undefined' };

    if (t.isStringLiteral(init)) {
      return { type: 'StringLiteral', value: init.value, inferredType: 'string' };
    }
    if (t.isNumericLiteral(init)) {
      return { type: 'NumericLiteral', value: init.value, inferredType: 'number' };
    }
    if (t.isBooleanLiteral(init)) {
      return { type: 'BooleanLiteral', value: init.value, inferredType: 'boolean' };
    }
    if (t.isNullLiteral(init)) {
      return { type: 'NullLiteral', inferredType: 'null' };
    }
    if (t.isArrayExpression(init)) {
      const elementTypes = this.analyzeArrayElements(init.elements);
      return {
        type: 'ArrayExpression',
        value: `[${init.elements.length} elements]`,
        inferredType: elementTypes.length === 1 ? `${elementTypes[0]}[]` : 'any[]'
      };
    }
    if (t.isObjectExpression(init)) {
      const properties = this.analyzeObjectProperties(init.properties);
      return {
        type: 'ObjectExpression',
        value: properties,
        inferredType: 'object'
      };
    }
    if (t.isNewExpression(init) && t.isIdentifier(init.callee)) {
      return {
        type: 'NewExpression',
        value: init.callee.name,
        inferredType: init.callee.name
      };
    }

    return { type: 'unknown', inferredType: 'any' };
  }

  private analyzeArrayElements(elements: any[]): string[] {
    const types: string[] = [];
    elements.forEach(el => {
      if (el && t.isStringLiteral(el)) types.push('string');
      else if (el && t.isNumericLiteral(el)) types.push('number');
      else if (el && t.isBooleanLiteral(el)) types.push('boolean');
      else types.push('unknown');
    });
    return [...new Set(types)];
  }

  private analyzeObjectProperties(properties: any[]): { [key: string]: string } {
    const result: { [key: string]: string } = {};
    properties.forEach(prop => {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
        const key = prop.key.name;
        if (t.isStringLiteral(prop.value)) result[key] = 'string';
        else if (t.isNumericLiteral(prop.value)) result[key] = 'number';
        else if (t.isBooleanLiteral(prop.value)) result[key] = 'boolean';
        else result[key] = 'unknown';
      }
    });
    return result;
  }

  async inferTypes(sourceCode: string): Promise<TypeInferenceResponse> {
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

    const prompt = `You are a static type inference assistant. Given a detailed AST (Abstract Syntax Tree) representation of JavaScript code, infer precise TypeScript-style types.

Analyze the following AST nodes extracted from JavaScript code:

\`\`\`json
${JSON.stringify(astSummary, null, 2)}
\`\`\`

The AST contains rich information including:
- Function bodies with return statements, variable usage patterns, and function calls
- Parameter usage patterns showing how parameters are used within functions
- Variable initializers with inferred types from literal values
- Type hints derived from operations and expressions

Use this detailed information to infer the most appropriate TypeScript types.

For each identifier, provide 5 possible type predictions ordered by confidence (most confident first).

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
    "return": ["type1", "type2", "type3", "type4", "type5"]
  }
}

CRITICAL EXTRACTION REQUIREMENTS:
1. MUST include ALL nodes from the AST analysis above
2. Use correct entity types:
   - FunctionDeclaration nodes → entity: "function"
   - VariableDeclaration nodes → entity: "variable"  
   - ClassDeclaration nodes → entity: "class"
   - ClassMethod nodes → entity: "class-method"
   - ArrowFunction nodes → entity: "function"

3. For ClassMethod nodes:
   - MUST use entity: "class-method"
   - Keep the full "ClassName.methodName" format as name

4. TYPES OBJECT RULES:
   - ALWAYS include "return" field as an array of 5 type predictions
   - Order the return types by confidence (most confident first)
   - For classes: first type should be "ClassName", then alternatives like "any", "object", etc.
   - For variables: provide 5 alternative types based on usage (e.g., ["string", "any", "unknown", "string | null", "string | undefined"])
   - For functions and class-methods: use both "params" and "return"
   - For variables/classes: omit "params" field entirely

5. TYPE INFERENCE RULES:
   - Use specific TypeScript types: string, number, boolean, array, function, void, null, undefined
   - For object types, prefer interface/class names if they exist in the code
   - For arrays, use "type[]" notation
   - For class instances, use the class name as the type
   - Analyze return statements for accurate return types
   - Use parameter usage patterns to infer parameter types
   - Provide diverse alternatives (e.g., specific type, union types, general types like 'any')

6. Analyze initialization values and function bodies for accurate type inference:
   - String literals → ["string", "any", "unknown", "string | null", "string | undefined"]
   - Number literals → ["number", "any", "unknown", "number | null", "number | undefined"]
   - Boolean literals → ["boolean", "any", "unknown", "boolean | null", "boolean | undefined"]
   - Array expressions → appropriate array type alternatives
   - Object expressions → object type alternatives
   - Class constructors → class name alternatives

NEVER return "undefined" as a type unless the value is explicitly undefined. Always include a "return" field as an array of 5 types in the types object.

Return only the JSON array, no markdown formatting or explanations.`;

    try {
      const response = await this.llmProvider.generateCompletion(prompt);

      if (!response.content) {
        throw new Error('No response content from LLM provider');
      }

      // Try to parse the JSON response
      try {
        const parsed = JSON.parse(response.content);
        const results = this.validateResponse(parsed);
        return {
          results,
          promptTokens: response.usage?.promptTokens || 0
        };
      } catch (parseError) {
        // If parsing fails, try to extract JSON from markdown blocks
        const jsonMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          const results = this.validateResponse(parsed);
          return {
            results,
            promptTokens: response.usage?.promptTokens || 0
          };
        }
        throw new Error(`Failed to parse JSON response: ${response.content}`);
      }
    } catch (error) {
      throw new Error(`LLM API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async inferTypesFromFile(filePath: string): Promise<TypeInferenceResponse> {
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

      // Validate location (more lenient, with defaults)
      let validLocation = { line: 1, column: 0 };
      if (location && typeof location === 'object') {
        validLocation = {
          line: typeof location.line === 'number' ? location.line : 1,
          column: typeof location.column === 'number' ? location.column : 0
        };
      }

      // Validate types
      if (!types || typeof types !== 'object') {
        throw new Error(`Invalid types at index ${index}: must be an object`);
      }

      // Validate return as array of 5 types
      if (!Array.isArray(types.return) || types.return.length !== 5) {
        throw new Error(`Invalid return type at index ${index}: must be an array of 5 strings`);
      }

      // Validate all return types are strings
      if (!types.return.every((t: any) => typeof t === 'string')) {
        throw new Error(`Invalid return type at index ${index}: all return types must be strings`);
      }

      // Handle params based on entity type
      let params: { [key: string]: string } | undefined;
      if (entity === 'function' || entity === 'class-method') {
        if (types.params && typeof types.params === 'object') {
          params = types.params;
        } else {
          params = {}; // Default to empty params for functions
        }
      }

      return {
        entity: entity as 'function' | 'variable' | 'class' | 'class-method',
        name,
        location: validLocation,
        types: {
          ...(params !== undefined && { params }),
          return: types.return
        }
      };
    });
  }
}