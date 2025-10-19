import * as ts from 'typescript';
import * as fs from 'fs';

export interface GroundTruthType {
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

export class TypeScriptParser {
    private typeAliases: Map<string, ts.TypeNode> = new Map();
    private interfaces: Map<string, ts.InterfaceDeclaration> = new Map();
    private classes: Set<string> = new Set();

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

        // Reset collections for each file
        this.typeAliases.clear();
        this.interfaces.clear();
        this.classes.clear();

        const getLocation = (node: ts.Node) => {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            return {
                line: line + 1, // Convert to 1-based
                column: character + 1 // Convert to 1-based
            };
        };

        // First pass: collect all type definitions
        const collectTypes = (node: ts.Node) => {
            // Collect type aliases
            if (ts.isTypeAliasDeclaration(node)) {
                this.typeAliases.set(node.name.text, node.type);
            }

            // Collect interfaces
            if (ts.isInterfaceDeclaration(node)) {
                this.interfaces.set(node.name.text, node);
            }

            // Collect class names
            if (ts.isClassDeclaration(node) && node.name) {
                this.classes.add(node.name.text);
            }

            ts.forEachChild(node, collectTypes);
        };

        // Second pass: extract entities with expanded types
        const visit = (node: ts.Node) => {
            // Function declarations
            if (ts.isFunctionDeclaration(node) && node.name) {
                const functionName = node.name.text;
                const params: { [key: string]: string } = {};

                // Extract parameter types
                node.parameters.forEach(param => {
                    if (ts.isIdentifier(param.name) && param.type) {
                        params[param.name.text] = this.typeToString(param.type, true);
                    }
                });

                // Extract return type
                const returnType = node.type ? this.typeToString(node.type, true) : 'any';

                groundTruth.push({
                    entity: 'function',
                    name: functionName,
                    location: getLocation(node),
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
                            location: getLocation(decl),
                            types: {
                                return: this.typeToString(decl.type, true)
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
                    location: getLocation(node),
                    types: {
                        return: node.name.text
                    }
                });

                // Process class methods
                node.members.forEach(member => {
                    if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && node.name) {
                        const className = node.name.text;
                        const methodName = member.name.text;
                        const fullMethodName = `${className}.${methodName}`;
                        const params: { [key: string]: string } = {};

                        member.parameters.forEach(param => {
                            if (ts.isIdentifier(param.name) && param.type) {
                                params[param.name.text] = this.typeToString(param.type, true);
                            }
                        });

                        const returnType = member.type ? this.typeToString(member.type, true) : 'any';

                        groundTruth.push({
                            entity: 'class-method',
                            name: fullMethodName,
                            location: getLocation(member),
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
                                params[param.name.text] = this.typeToString(param.type, true);
                            }
                        });

                        const returnType = arrowFunc.type ? this.typeToString(arrowFunc.type, true) : 'any';

                        groundTruth.push({
                            entity: 'function',
                            name: decl.name.text,
                            location: getLocation(decl),
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

        // Execute both passes
        collectTypes(sourceFile);
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
     * @param typeNode The TypeScript type node to convert
     * @param expandCustomTypes Whether to expand custom types/interfaces to their object literal form
     */
    private typeToString(typeNode: ts.TypeNode, expandCustomTypes: boolean = false): string {
        if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
            const typeName = typeNode.typeName.text;

            // If we should expand custom types and this is not a class type
            if (expandCustomTypes && !this.classes.has(typeName)) {
                // Check if it's a type alias
                if (this.typeAliases.has(typeName)) {
                    const aliasType = this.typeAliases.get(typeName)!;
                    return this.typeToString(aliasType, expandCustomTypes);
                }

                // Check if it's an interface
                if (this.interfaces.has(typeName)) {
                    const interfaceDecl = this.interfaces.get(typeName)!;
                    return this.interfaceToObjectLiteral(interfaceDecl);
                }
            }

            // Handle generic types like Array<T>
            if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
                const baseType = typeName;
                const typeArgs = typeNode.typeArguments.map(arg => this.typeToString(arg, expandCustomTypes)).join(', ');
                return `${baseType}<${typeArgs}>`;
            }
            return typeName;
        }

        if (ts.isArrayTypeNode(typeNode)) {
            return this.typeToString(typeNode.elementType, expandCustomTypes) + '[]';
        }

        if (ts.isUnionTypeNode(typeNode)) {
            return typeNode.types.map(t => this.typeToString(t, expandCustomTypes)).join(' | ');
        }

        if (ts.isTypeLiteralNode(typeNode)) {
            const members = typeNode.members.map(member => {
                if (ts.isPropertySignature(member) && ts.isIdentifier(member.name) && member.type) {
                    return `${member.name.text}: ${this.typeToString(member.type, expandCustomTypes)}`;
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

    /**
     * Convert an interface declaration to object literal string representation
     */
    private interfaceToObjectLiteral(interfaceDecl: ts.InterfaceDeclaration): string {
        const members = interfaceDecl.members.map(member => {
            if (ts.isPropertySignature(member) && ts.isIdentifier(member.name) && member.type) {
                const optional = member.questionToken ? '?' : '';
                return `${member.name.text}${optional}: ${this.typeToString(member.type, true)}`;
            }
            return 'unknown';
        });
        return `{ ${members.join('; ')} }`;
    }
}