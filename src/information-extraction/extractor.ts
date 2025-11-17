import * as fs from 'fs';
import * as path from 'path';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { babelParse } from './parser.js';

interface Location {
    file: string;
    start: { line: number; column: number };
    end: { line: number; column: number };
}

interface ExtractedNode {
    location: Location;
    context: string;
    rawSource: string;
}

interface FunctionInfo extends ExtractedNode {
    name: string;
    exportStatus: 'default' | 'named' | 'local';
    params: any[];
    isAsync: boolean;
    isGenerator: boolean;
    returns: any[];
}

interface CallSiteInfo extends ExtractedNode {
    callee: string;
    args: any[];
}

interface ObjectShapeInfo extends ExtractedNode {
    properties: any[];
}

interface VariableInfo extends ExtractedNode {
    name: string;
    initialValue: any;
    reassigned: boolean;
}

interface ClassInfo extends ExtractedNode {
    name: string;
    superClass: string | null;
    methods: any[];
    properties: any[];
}

interface JSDocInfo extends ExtractedNode { }
interface ImportInfo extends ExtractedNode { }
interface ExportInfo extends ExtractedNode { }
interface LiteralEvidenceInfo extends ExtractedNode { }
interface ControlFlowHintInfo extends ExtractedNode { }

interface ExtractionOutput {
    functions: FunctionInfo[];
    callSites: CallSiteInfo[];
    objectShapes: ObjectShapeInfo[];
    variables: VariableInfo[];
    classes: ClassInfo[];
    jsdoc: JSDocInfo[];
    imports: ImportInfo[];
    exports: ExportInfo[];
    literalEvidence: LiteralEvidenceInfo[];
    controlFlowHints: ControlFlowHintInfo[];
}

function getRawSource(sourceCode: string, node: t.Node): string {
    if (node.start != null && node.end != null) {
        return sourceCode.slice(node.start, node.end);
    }
    return '';
}


export function extractInformationFromDirectory(dirPath: string): ExtractionOutput {
    const output: ExtractionOutput = {
        functions: [],
        callSites: [],
        objectShapes: [],
        variables: [],
        classes: [],
        jsdoc: [],
        imports: [],
        exports: [],
        literalEvidence: [],
        controlFlowHints: [],
    };

    const files = getAllFiles(dirPath);

    for (const file of files) {
        if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
            const sourceCode = fs.readFileSync(file, 'utf-8');
            const ast = babelParse(sourceCode);

            const comments = ast.comments;
            if (comments) {
                for (const comment of comments) {
                    if (comment.value.includes('@param') || comment.value.includes('@returns') || comment.value.includes('@type') || comment.value.includes('@typedef')) {
                        output.jsdoc.push({
                            location: {
                                file,
                                start: comment.loc!.start,
                                end: comment.loc!.end,
                            },
                            context: 'JSDoc comments provide type information directly from the source code.',
                            rawSource: comment.value,
                        });
                    }
                }
            }

            traverse(ast, {
                Function(path) {
                    const node = path.node;
                    let name = '<anonymous>';

                    if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
                        if (node.id) {
                            name = node.id.name;
                        } else if (t.isVariableDeclarator(path.parent)) {
                            // Handle `const myFunc = () => {}`
                            if (t.isIdentifier(path.parent.id)) {
                                name = path.parent.id.name;
                            }
                        }
                    } else if (t.isObjectMethod(node) || t.isClassMethod(node) || t.isClassPrivateMethod(node)) {
                        if (t.isIdentifier(node.key)) {
                            name = node.key.name;
                        }
                    } else if (t.isArrowFunctionExpression(node)) {
                        if (t.isVariableDeclarator(path.parent)) {
                            if (t.isIdentifier(path.parent.id)) {
                                name = path.parent.id.name;
                            }
                        }
                    }

                    let exportStatus: 'default' | 'named' | 'local' = 'local';
                    if (t.isExportDefaultDeclaration(path.parent)) {
                        exportStatus = 'default';
                    } else if (t.isExportNamedDeclaration(path.parent)) {
                        exportStatus = 'named';
                    }


                    const func: FunctionInfo = {
                        name,
                        exportStatus,
                        params: node.params.map(p => getRawSource(sourceCode, p)),
                        isAsync: node.async || false,
                        isGenerator: node.generator || false,
                        returns: [],
                        location: {
                            file,
                            start: node.loc!.start,
                            end: node.loc!.end,
                        },
                        context: 'Function definition provides a scope for variables and can be a type itself.',
                        rawSource: getRawSource(sourceCode, node),
                    };

                    path.traverse({
                        ReturnStatement(returnPath) {
                            if (returnPath.node.argument) {
                                func.returns.push(getRawSource(sourceCode, returnPath.node.argument));
                            }
                        }
                    });

                    output.functions.push(func);
                },
                CallExpression(path) {
                    const node = path.node;
                    output.callSites.push({
                        callee: getRawSource(sourceCode, node.callee),
                        args: node.arguments.map(arg => getRawSource(sourceCode, arg)),
                        location: {
                            file,
                            start: node.loc!.start,
                            end: node.loc!.end,
                        },
                        context: 'A function call can reveal the types of arguments and the return type of the callee.',
                        rawSource: getRawSource(sourceCode, node),
                    });
                },
                ObjectExpression(path) {
                    const node = path.node;
                    output.objectShapes.push({
                        properties: node.properties.map(prop => getRawSource(sourceCode, prop)),
                        location: {
                            file,
                            start: node.loc!.start,
                            end: node.loc!.end,
                        },
                        context: 'Object literals define the shape of an object, which is a structural type.',
                        rawSource: getRawSource(sourceCode, node),
                    });
                },
                VariableDeclarator(path) {
                    const node = path.node;
                    const scope = path.scope;
                    const binding = scope.getBinding((node.id as t.Identifier).name);
                    output.variables.push({
                        name: (node.id as t.Identifier).name,
                        initialValue: node.init ? getRawSource(sourceCode, node.init) : null,
                        reassigned: binding ? binding.constantViolations.length > 0 : false,
                        location: {
                            file,
                            start: node.loc!.start,
                            end: node.loc!.end,
                        },
                        context: 'A variable declaration binds a value to a name, and its initial value is a strong hint for its type.',
                        rawSource: getRawSource(sourceCode, node),
                    });
                },
                ClassDeclaration(path) {
                    const node = path.node;
                    output.classes.push({
                        name: node.id ? node.id.name : '<anonymous>',
                        superClass: node.superClass ? getRawSource(sourceCode, node.superClass) : null,
                        methods: node.body.body.filter(item => t.isClassMethod(item)).map(item => getRawSource(sourceCode, item)),
                        properties: node.body.body.filter(item => t.isClassProperty(item)).map(item => getRawSource(sourceCode, item)),
                        location: {
                            file,
                            start: node.loc!.start,
                            end: node.loc!.end,
                        },
                        context: 'A class declaration defines a blueprint for creating objects with a specific set of properties and methods.',
                        rawSource: getRawSource(sourceCode, node),
                    });
                },
                ImportDeclaration(path) {
                    const node = path.node;
                    output.imports.push({
                        location: {
                            file,
                            start: node.loc!.start,
                            end: node.loc!.end,
                        },
                        context: 'Imports bring in types and values from other modules.',
                        rawSource: getRawSource(sourceCode, node),
                    });
                },
                ExportDeclaration(path) {
                    const node = path.node;
                    output.exports.push({
                        location: {
                            file,
                            start: node.loc!.start,
                            end: node.loc!.end,
                        },
                        context: 'Exports expose functions, variables, and types to other modules.',
                        rawSource: getRawSource(sourceCode, node),
                    });
                },
                Literal(path) {
                    const node = path.node;
                    output.literalEvidence.push({
                        location: {
                            file,
                            start: node.loc!.start,
                            end: node.loc!.end,
                        },
                        context: 'Literal values are the most direct evidence for primitive types.',
                        rawSource: getRawSource(sourceCode, node),
                    });
                },
                IfStatement(path) {
                    const node = path.node;
                    if (t.isBinaryExpression(node.test) && (node.test.operator === '===' || node.test.operator === '!==' || node.test.operator === '==' || node.test.operator === '!=')) {
                        if (t.isUnaryExpression(node.test.left) && node.test.left.operator === 'typeof') {
                            output.controlFlowHints.push({
                                location: {
                                    file,
                                    start: node.loc!.start,
                                    end: node.loc!.end,
                                },
                                context: 'A typeof check in a conditional statement provides a strong hint about the type of a variable in a specific branch.',
                                rawSource: getRawSource(sourceCode, node),
                            });
                        }
                    }
                },
                SwitchStatement(path) {
                    const node = path.node;
                    output.controlFlowHints.push({
                        location: {
                            file,
                            start: node.loc!.start,
                            end: node.loc!.end,
                        },
                        context: 'A switch statement often refines the type of a variable based on the case.',
                        rawSource: getRawSource(sourceCode, node),
                    });
                }
            });
        }
    }

    return output;
}

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
    const files = fs.readdirSync(dirPath);

    files.forEach(function (file) {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
            arrayOfFiles.push(fullPath);
        }
    });

    return arrayOfFiles;
}
