// @ts-nocheck — The syntest-type-inference library uses extensionless imports internally,
// which TypeScript's NodeNext resolution can't follow transitively. Runtime works via tsx.
import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import * as t from '@babel/types';

// Syntest imports
import { TypeExtractor } from '../../syntest-type-inference/lib/type/discovery/TypeExtractor.js';
import { InferenceTypeModelFactory } from '../../syntest-type-inference/lib/type/resolving/InferenceTypeModelFactory.js';
import { TypeModel } from '../../syntest-type-inference/lib/type/resolving/TypeModel.js';
import { TypeEnum } from '../../syntest-type-inference/lib/type/resolving/TypeEnum.js';
import {
    Element,
    ElementType,
    type Identifier as SyntestIdentifier,
} from '../../syntest-type-inference/lib/type/discovery/element/Element.js';
import { Relation, RelationType } from '../../syntest-type-inference/lib/type/discovery/relation/Relation.js';

// Syntest vendor initialization — use relative paths to share singletons
// with the syntest library code
import { setupLogger } from '../../syntest-type-inference/vendor/logging/index.js';
import { initializePseudoRandomNumberGenerator } from '../../syntest-type-inference/vendor/prng/index.js';

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

/** Maps syntest TypeEnum values to TypeScript type strings */
function syntestTypeToTS(typeKey: string): string {
    // Handle composite dependency keys like "someId<>numeric"
    const typeEnum = typeKey.includes('<>') ? typeKey.split('<>').pop()! : typeKey;

    switch (typeEnum) {
        case TypeEnum.NUMERIC:
        case TypeEnum.INTEGER:
            return 'number';
        case TypeEnum.STRING:
            return 'string';
        case TypeEnum.BOOLEAN:
            return 'boolean';
        case TypeEnum.NULL:
            return 'null';
        case TypeEnum.UNDEFINED:
            return 'undefined';
        case TypeEnum.REGEX:
            return 'RegExp';
        case TypeEnum.ARRAY:
            return 'any[]';
        case TypeEnum.OBJECT:
            return 'object';
        case TypeEnum.FUNCTION:
            return 'Function';
        default:
            return typeEnum;
    }
}

/** Extracts top-N ranked TS type predictions from a probability map */
function getTopTypesPredictions(
    probabilities: Map<string, number>,
    n: number = 5,
): string[] {
    // Aggregate probabilities by resolved TS type
    const aggregated = new Map<string, number>();
    for (const [key, prob] of probabilities.entries()) {
        const tsType = syntestTypeToTS(key);
        aggregated.set(tsType, (aggregated.get(tsType) ?? 0) + prob);
    }

    // Sort by probability descending
    const sorted = [...aggregated.entries()].sort((a, b) => b[1] - a[1]);

    // Take top types, deduplicating
    const result: string[] = [];
    for (const [type] of sorted) {
        if (!result.includes(type)) {
            result.push(type);
        }
        if (result.length >= n) break;
    }

    // Pad to exactly n with fallback types
    const fallbacks = ['any', 'unknown', 'void', 'never', 'undefined'];
    for (const fb of fallbacks) {
        if (result.length >= n) break;
        if (!result.includes(fb)) {
            result.push(fb);
        }
    }

    return result.slice(0, n);
}

/** Parse a node ID string to extract line/column */
function parseNodeIdLocation(nodeId: string): { line: number; column: number } {
    // Format: filepath:startLine:startColumn:::endLine:endColumn:::startIndex:endIndex
    const parts = nodeId.split(':::');
    if (parts.length >= 1) {
        const firstPart = parts[0]; // filepath:startLine:startColumn
        const segments = firstPart.split(':');
        if (segments.length >= 3) {
            const line = parseInt(segments[segments.length - 2], 10);
            const column = parseInt(segments[segments.length - 1], 10);
            if (!isNaN(line) && !isNaN(column)) {
                return { line, column };
            }
        }
    }
    return { line: 1, column: 0 };
}

// Ensure syntest dependencies are initialized once
let syntestInitialized = false;
function ensureSyntestInitialized(): void {
    if (syntestInitialized) return;

    // Initialize logger with silent console (no file transports)
    try {
        setupLogger('/tmp/syntest-logs', [], 'silent');
    } catch {
        // Logger may already be initialized
    }

    // Initialize PRNG with a fixed seed for reproducibility
    try {
        initializePseudoRandomNumberGenerator('syntest-inference-seed');
    } catch {
        // PRNG may already be initialized
    }

    syntestInitialized = true;
}

interface IdentifierInfo {
    name: string;
    entity: 'function' | 'variable' | 'class' | 'class-method';
    bindingId: string;
    elementId: string;
    location: { line: number; column: number };
    params?: Map<number, { name: string; id: string }>;
}

export class SyntestTypeInference {
    private typeExtractor: TypeExtractor;
    private typeModelFactory: InferenceTypeModelFactory;

    private constructor() {
        ensureSyntestInitialized();
        this.typeExtractor = new TypeExtractor(true); // syntaxForgiving = true
        this.typeModelFactory = new InferenceTypeModelFactory();
    }

    static async create(): Promise<SyntestTypeInference> {
        return new SyntestTypeInference();
    }

    async inferTypes(sourceCode: string, filePath?: string): Promise<TypeInferenceResponse> {
        const filepath = filePath ? path.resolve(filePath) : 'anonymous.js';

        // 1. Parse with Babel
        const ast = this.parseSource(sourceCode);

        // 2. Extract elements and relations
        const elementsResult = this.typeExtractor.extractElements(filepath, ast);
        const relationsResult = this.typeExtractor.extractRelations(filepath, ast);

        const elements: Map<string, Element> = (elementsResult as any).result ?? elementsResult;
        const relations: Map<string, Relation> = (relationsResult as any).result ?? relationsResult;

        // 3. Resolve types → TypeModel
        this.typeModelFactory.reset();
        let typeModel: TypeModel;
        try {
            typeModel = this.typeModelFactory.resolveTypes(elements, relations);
        } catch (resolveError) {
            // The syntest library can fail on some TS class patterns (e.g., ClassProperty handling).
            // Fall back to an empty TypeModel by resetting and creating a minimal one.
            console.warn(`[SynTest] Type resolution warning: ${resolveError instanceof Error ? resolveError.message : String(resolveError)}`);
            this.typeModelFactory.reset();
            // Create minimal type nodes for all identifiers
            typeModel = this.typeModelFactory.resolveTypes(new Map(), new Map());
        }

        // 4. Classify identifiers by entity type using relations
        const identifiers = this.classifyIdentifiers(elements, relations, filepath);

        // 5. For each identifier, get probability distribution and convert to predictions
        const results: TypeInferenceResult[] = [];

        for (const info of identifiers.values()) {
            try {
                // Try to get probabilities from the TypeModel using bindingId
                let probabilities: Map<string, number> | undefined;

                try {
                    const typeNode = typeModel.getTypeNode(info.bindingId);
                    probabilities = typeNode.getTypeProbabilities();
                } catch {
                    // bindingId not in model, try elementId directly
                    try {
                        const typeNode = typeModel.getTypeNode(info.elementId);
                        probabilities = typeNode.getTypeProbabilities();
                    } catch {
                        // Not found in model - skip or use empty
                        probabilities = new Map();
                    }
                }

                const returnTypes = getTopTypesPredictions(probabilities ?? new Map(), 5);

                // For functions/class-methods, extract parameter types
                let params: { [paramName: string]: string } | undefined;
                if (info.entity === 'function' || info.entity === 'class-method') {
                    params = this.extractParamTypes(info, typeModel);
                }

                results.push({
                    entity: info.entity,
                    name: info.name,
                    location: info.location,
                    types: {
                        ...(params !== undefined && { params }),
                        return: returnTypes,
                    },
                });
            } catch {
                // Skip identifiers that cause errors
            }
        }

        return {
            results,
            promptTokens: 0, // No LLM used
        };
    }

    async inferTypesFromFile(filePath: string): Promise<TypeInferenceResponse> {
        try {
            const sourceCode = fs.readFileSync(filePath, 'utf8');
            return await this.inferTypes(sourceCode, filePath);
        } catch (error: any) {
            if (error?.code === 'ENOENT') {
                throw new Error(`File not found: ${filePath}`);
            }
            throw error;
        }
    }

    private parseSource(sourceCode: string): t.File {
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
                    'optionalChaining',
                ],
            });
        } catch (error) {
            throw new Error(`Failed to parse JavaScript code: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Classify identifiers into entity types (function, variable, class, class-method)
     * by analysing the relations map.
     *
     * Returns a Map keyed by a display name (e.g., "myFunc" or "MyClass.myMethod")
     * to avoid duplicates.
     */
    private classifyIdentifiers(
        elements: Map<string, Element>,
        relations: Map<string, Relation>,
        filepath: string,
    ): Map<string, IdentifierInfo> {
        const result = new Map<string, IdentifierInfo>();

        // Build helper lookups
        const functionDefinitionTypes = new Set([
            RelationType.FunctionDefinition,
            RelationType.FunctionStarDefinition,
            RelationType.AsyncFunctionDefinition,
            RelationType.AsyncFunctionStarDefinition,
        ]);

        const classMethodTypes = new Set([
            RelationType.ClassMethod,
            RelationType.AsyncClassMethod,
            RelationType.StaticClassMethod,
            RelationType.StaticAsyncClassMethod,
        ]);

        // Track which bindingIds are functions, classes, class-methods
        const functionBindingIds = new Set<string>();
        const classBindingIds = new Set<string>();
        const classMethodNodeIds = new Set<string>(); // ClassMethod node IDs
        const classNodeToNameId = new Map<string, string>(); // classDefinitionNode → classNameElementId

        // First pass: identify class definitions so we can resolve class names for methods
        for (const relation of relations.values()) {
            if (relation.type === RelationType.ClassDefinition) {
                const classNameId = relation.involved[0];
                if (classNameId) {
                    classNodeToNameId.set(relation.id, classNameId);
                    const elem = elements.get(classNameId);
                    if (elem && elem.type === ElementType.Identifier) {
                        classBindingIds.add(elem.bindingId);
                    }
                }
            }
        }

        // Second pass: identify functions and class methods
        for (const relation of relations.values()) {
            if (functionDefinitionTypes.has(relation.type)) {
                const nameId = relation.involved[0];
                if (nameId) {
                    const elem = elements.get(nameId);
                    if (elem && elem.type === ElementType.Identifier) {
                        // Check if this is an arrow function assigned to a variable
                        // (the RelationVisitor uses the VariableDeclarator node for arrow fns)
                        functionBindingIds.add(elem.bindingId);
                    }
                }
            }

            if (classMethodTypes.has(relation.type)) {
                // involved[0] = classParent node ID, involved[1] = ClassMethod node ID
                const methodNodeId = relation.involved[1];
                if (methodNodeId) {
                    classMethodNodeIds.add(methodNodeId);
                }
            }
        }

        // Build a map from element ID to element for quick lookup
        const idToElement = new Map<string, Element>();
        for (const [id, elem] of elements) {
            idToElement.set(id, elem);
        }

        // Collect identifiers, grouping by bindingId to avoid duplicates
        const bindingIdToInfo = new Map<string, IdentifierInfo>();

        for (const [id, elem] of elements) {
            if (elem.type !== ElementType.Identifier) continue;
            if (!id.startsWith(filepath)) continue;

            const identElem = elem as SyntestIdentifier;
            const bindingId = identElem.bindingId;

            // Skip if we already have an entry for this bindingId
            // (prefer the declaration-site element)
            if (bindingIdToInfo.has(bindingId)) {
                // If the current element IS the declaration (id === bindingId), prefer it
                if (id !== bindingId) continue;
            }

            // Determine entity type
            let entity: 'function' | 'variable' | 'class' | 'class-method' = 'variable';

            if (classBindingIds.has(bindingId)) {
                entity = 'class';
            } else if (functionBindingIds.has(bindingId)) {
                entity = 'function';
            }

            const location = parseNodeIdLocation(id);

            bindingIdToInfo.set(bindingId, {
                name: identElem.name,
                entity,
                bindingId,
                elementId: id,
                location,
            });
        }

        // Now handle class methods separately
        // For each ClassMethod relation, find the method name and class name
        for (const relation of relations.values()) {
            if (!classMethodTypes.has(relation.type)) continue;

            const classParentId = relation.involved[0]; // ClassDeclaration node ID
            const methodNodeId = relation.involved[1]; // ClassMethod node ID

            if (!classParentId || !methodNodeId) continue;

            // Find class name from the ClassDefinition relation
            let className = 'UnknownClass';
            const classNameElemId = classNodeToNameId.get(classParentId);
            if (classNameElemId) {
                const classElem = idToElement.get(classNameElemId);
                if (classElem && classElem.type === ElementType.Identifier) {
                    className = (classElem as SyntestIdentifier).name;
                }
            }

            // Find the method name: it's an Identifier element that is a child of the ClassMethod node.
            // The method key identifier's ID will start with the same filepath and overlap with 
            // the method node's location. We look for Identifier elements whose bindingId
            // matches their own id (declaration site) and falls within the method's location range.
            let methodName: string | undefined;
            const methodLocation = parseNodeIdLocation(methodNodeId);

            // Find identifier elements on the same line as the method
            for (const [elemId, elem] of elements) {
                if (elem.type !== ElementType.Identifier) continue;
                if (!elemId.startsWith(filepath)) continue;

                const elemLoc = parseNodeIdLocation(elemId);
                const identElem = elem as SyntestIdentifier;

                // The method key identifier should be on the same line and near the method start
                if (elemLoc.line === methodLocation.line && elemLoc.column >= methodLocation.column) {
                    // Check this isn't one of the parameters (which come after the name)
                    // The method name is usually the first identifier on the method line
                    if (!methodName) {
                        methodName = identElem.name;
                    } else if (elemLoc.column < parseNodeIdLocation(
                        // Find what we had before
                        [...elements].find(([, e]) =>
                            e.type === ElementType.Identifier &&
                            (e as SyntestIdentifier).name === methodName
                        )?.[0] ?? ''
                    ).column) {
                        methodName = identElem.name;
                    }
                    break; // Take the first identifier on the method line
                }
            }

            if (!methodName) {
                methodName = 'unknownMethod';
            }

            // Skip constructors — they're not typically type-inferred as separate entities
            if (relation.type === RelationType.ClassMethod && methodName === 'constructor') {
                continue;
            }

            const displayName = `${className}.${methodName}`;
            const location = parseNodeIdLocation(methodNodeId);

            // Extract parameter info for this method
            const paramIds = relation.involved.slice(2);
            const params = new Map<number, { name: string; id: string }>();
            for (let i = 0; i < paramIds.length; i++) {
                const paramElem = idToElement.get(paramIds[i]);
                if (paramElem && paramElem.type === ElementType.Identifier) {
                    params.set(i, {
                        name: (paramElem as SyntestIdentifier).name,
                        id: paramIds[i],
                    });
                }
            }

            result.set(displayName, {
                name: displayName,
                entity: 'class-method',
                bindingId: methodNodeId,
                elementId: methodNodeId,
                location,
                params,
            });
        }

        // Add function definitions with their parameter info
        for (const relation of relations.values()) {
            if (!functionDefinitionTypes.has(relation.type)) continue;

            const nameId = relation.involved[0];
            if (!nameId) continue;

            const elem = idToElement.get(nameId);
            if (!elem || elem.type !== ElementType.Identifier) continue;

            const identElem = elem as SyntestIdentifier;
            const info = bindingIdToInfo.get(identElem.bindingId);
            if (!info) continue;

            // Extract parameter info
            const paramIds = relation.involved.slice(1);
            const params = new Map<number, { name: string; id: string }>();
            for (let i = 0; i < paramIds.length; i++) {
                const paramElem = idToElement.get(paramIds[i]);
                if (paramElem && paramElem.type === ElementType.Identifier) {
                    params.set(i, {
                        name: (paramElem as SyntestIdentifier).name,
                        id: paramIds[i],
                    });
                }
            }

            info.params = params;
        }

        // Merge function/variable/class entries
        for (const [_, info] of bindingIdToInfo) {
            // Skip identifiers that are parameters of functions/methods
            // (they'd be captured but we don't want them as separate top-level entries)
            // Only include identifiers at the declaration site or that are unique
            if (!result.has(info.name)) {
                result.set(info.name, info);
            }
        }

        return result;
    }

    /**
     * Extract parameter types for a function/class-method from the TypeModel.
     */
    private extractParamTypes(
        info: IdentifierInfo,
        typeModel: TypeModel,
    ): { [paramName: string]: string } {
        const params: { [paramName: string]: string } = {};

        if (!info.params) return params;

        for (const [_, paramInfo] of info.params) {
            try {
                let probabilities: Map<string, number>;
                try {
                    const typeNode = typeModel.getTypeNode(paramInfo.id);
                    probabilities = typeNode.getTypeProbabilities();
                } catch {
                    probabilities = new Map();
                }

                const topTypes = getTopTypesPredictions(probabilities, 1);
                params[paramInfo.name] = topTypes[0] || 'any';
            } catch {
                params[paramInfo.name] = 'any';
            }
        }

        return params;
    }
}
