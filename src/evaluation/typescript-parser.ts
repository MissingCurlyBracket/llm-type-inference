import * as ts from 'typescript';
import * as fs from 'fs';

export interface GroundTruthType {
    entity: 'function' | 'variable' | 'class';
    name: string;
    types: {
        params?: { [paramName: string]: string };
        return: string;
    };
}

export class TypeScriptParser {
    /**
     * Parse TypeScript file and extract type information as ground truth
     */
    extractGroundTruth(tsFilePath: string): GroundTruthType[] {
        const sourceCode = fs.readFileSync(tsFilePath, 'utf-8');
        const sourceFile = ts.createSourceFile(
            tsFilePath,
            sourceCode,
            ts.ScriptTarget.Latest,
            true
        );

        const groundTruth: GroundTruthType[] = [];
        
        const visit = (node: ts.Node) => {
            // Function declarations
            if (ts.isFunctionDeclaration(node) && node.name) {
                const functionName = node.name.text;
                const params: { [key: string]: string } = {};
                
                // Extract parameter types
                node.parameters.forEach(param => {
                    if (ts.isIdentifier(param.name) && param.type) {
                        params[param.name.text] = this.typeToString(param.type);
                    }
                });

                // Extract return type
                const returnType = node.type ? this.typeToString(node.type) : 'any';

                groundTruth.push({
                    entity: 'function',
                    name: functionName,
                    types: {
                        params,
                        return: returnType
                    }
                });
            }

            // Variable declarations
            if (ts.isVariableStatement(node)) {
                node.declarationList.declarations.forEach(decl => {
                    if (ts.isIdentifier(decl.name) && decl.type) {
                        groundTruth.push({
                            entity: 'variable',
                            name: decl.name.text,
                            types: {
                                return: this.typeToString(decl.type)
                            }
                        });
                    }
                });
            }

            // Class declarations
            if (ts.isClassDeclaration(node) && node.name) {
                groundTruth.push({
                    entity: 'class',
                    name: node.name.text,
                    types: {
                        return: node.name.text
                    }
                });

                // Process class methods
                node.members.forEach(member => {
                    if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
                        const methodName = member.name.text;
                        const params: { [key: string]: string } = {};
                        
                        member.parameters.forEach(param => {
                            if (ts.isIdentifier(param.name) && param.type) {
                                params[param.name.text] = this.typeToString(param.type);
                            }
                        });

                        const returnType = member.type ? this.typeToString(member.type) : 'any';

                        groundTruth.push({
                            entity: 'function',
                            name: methodName,
                            types: {
                                params,
                                return: returnType
                            }
                        });
                    }
                });
            }

            // Arrow functions assigned to variables
            if (ts.isVariableStatement(node)) {
                node.declarationList.declarations.forEach(decl => {
                    if (ts.isIdentifier(decl.name) && decl.initializer && ts.isArrowFunction(decl.initializer)) {
                        const arrowFunc = decl.initializer;
                        const params: { [key: string]: string } = {};
                        
                        arrowFunc.parameters.forEach(param => {
                            if (ts.isIdentifier(param.name) && param.type) {
                                params[param.name.text] = this.typeToString(param.type);
                            }
                        });

                        const returnType = arrowFunc.type ? this.typeToString(arrowFunc.type) : 'any';

                        groundTruth.push({
                            entity: 'function',
                            name: decl.name.text,
                            types: {
                                params,
                                return: returnType
                            }
                        });
                    }
                });
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
        return groundTruth;
    }

    /**
     * Convert TypeScript code to JavaScript by removing type annotations
     */
    convertToJavaScript(tsFilePath: string): string {
        const sourceCode = fs.readFileSync(tsFilePath, 'utf-8');
        
        const result = ts.transpile(sourceCode, {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
            removeComments: false
        });

        return result;
    }

    /**
     * Convert TypeScript type node to string representation
     */
    private typeToString(typeNode: ts.TypeNode): string {
        if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
            // Handle generic types like Array<T>
            if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
                const baseType = typeNode.typeName.text;
                const typeArgs = typeNode.typeArguments.map(arg => this.typeToString(arg)).join(', ');
                return `${baseType}<${typeArgs}>`;
            }
            return typeNode.typeName.text;
        }

        if (ts.isArrayTypeNode(typeNode)) {
            return this.typeToString(typeNode.elementType) + '[]';
        }

        if (ts.isUnionTypeNode(typeNode)) {
            return typeNode.types.map(t => this.typeToString(t)).join(' | ');
        }

        if (ts.isTypeLiteralNode(typeNode)) {
            const members = typeNode.members.map(member => {
                if (ts.isPropertySignature(member) && ts.isIdentifier(member.name) && member.type) {
                    return `${member.name.text}: ${this.typeToString(member.type)}`;
                }
                return 'unknown';
            });
            return `{ ${members.join('; ')} }`;
        }

        // Handle basic types
        switch (typeNode.kind) {
            case ts.SyntaxKind.StringKeyword:
                return 'string';
            case ts.SyntaxKind.NumberKeyword:
                return 'number';
            case ts.SyntaxKind.BooleanKeyword:
                return 'boolean';
            case ts.SyntaxKind.VoidKeyword:
                return 'void';
            case ts.SyntaxKind.UndefinedKeyword:
                return 'undefined';
            case ts.SyntaxKind.NullKeyword:
                return 'null';
            case ts.SyntaxKind.AnyKeyword:
                return 'any';
            default:
                return 'unknown';
        }
    }
}