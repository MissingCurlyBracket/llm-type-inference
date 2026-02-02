
import { QdrantClient } from '@qdrant/js-client-rest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { extractInformationFromDirectory, babelParse } from '../../src/information-extraction/index.js';
import { env, pipeline } from '@xenova/transformers';
import * as fs from 'fs';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';

// Hack for babel traverse import compatibility
const traverse = (_traverse as any).default as (parent: t.Node, opts: any) => void;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allow local models
env.allowLocalModels = true;

interface TargetRepo {
    repository: string;
    files: {
        path: string;
        functions: string[];
    }[];
}

interface RetrievalResult {
    score: number;
    payload: any;
}

interface FunctionQueryResult {
    repository: string;
    filePath: string;
    functionName: string;
    results: RetrievalResult[];
}

const TARGET_FUNCTIONS_PATH = path.resolve(__dirname, '../target-functions.json');
const RESULTS_DIR = path.resolve(__dirname, 'results');

if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR);
}

function getRawSource(sourceCode: string, node: t.Node): string {
    if (node.start != null && node.end != null) {
        return sourceCode.slice(node.start, node.end);
    }
    return '';
}

function findFunctionSource(filePath: string, functionName: string): string | null {
    if (!fs.existsSync(filePath)) {
        console.warn(`File not found: ${filePath}`);
        return null;
    }
    const sourceCode = fs.readFileSync(filePath, 'utf-8');
    try {
        const ast = babelParse(sourceCode);
        let foundSource: string | null = null;

        traverse(ast, {
            Function(path) {
                if (foundSource) return;
                const node = path.node;
                let name = '<anonymous>';

                if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
                    if (node.id) {
                        name = node.id.name;
                    } else if (t.isVariableDeclarator(path.parent)) {
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

                if (name === functionName) {
                    foundSource = getRawSource(sourceCode, node);
                }
            }
        });

        return foundSource;
    } catch (e) {
        console.error(`Error parsing ${filePath}:`, e);
        return null;
    }
}

async function runExperiment() {
    const targetFunctions: TargetRepo[] = JSON.parse(fs.readFileSync(TARGET_FUNCTIONS_PATH, 'utf-8'));

    // Load model once
    console.log('Loading embedding model...');
    const extractor = await pipeline('feature-extraction', 'Xenova/bert-base-uncased', { revision: 'default' });
    console.log('Embedding model loaded.');

    const qdrantClient = new QdrantClient({ url: 'http://localhost:6333' });
    const allResults: FunctionQueryResult[] = [];

    for (const repo of targetFunctions) {
        const repoName = repo.repository;
        const repoPath = path.resolve(__dirname, '../../', repoName);
        const collectionName = repoName;

        console.log(`Processing repository: ${repoName} at ${repoPath}`);

        if (!fs.existsSync(repoPath)) {
            console.error(`Repository path not found: ${repoPath}`);
            continue;
        }

        // Check if collection exists
        const collections = await qdrantClient.getCollections();
        const collectionExists = collections.collections.some(c => c.name === collectionName);

        if (!collectionExists) {
            // 1. Extract and Embed Repo
            console.log(`Extracting information from ${repoName}...`);
            const extractedInfo = extractInformationFromDirectory(repoPath);

            console.log(`Creating Qdrant collection: ${collectionName}`);
            await qdrantClient.recreateCollection(collectionName, {
                vectors: {
                    size: 768,
                    distance: 'Cosine',
                },
            });

            const allData: any[] = [];
            for (const key of Object.keys(extractedInfo)) {
                const items = extractedInfo[key as keyof typeof extractedInfo];
                if (Array.isArray(items)) {
                    // Avoid spread operator for large arrays to prevent stack overflow
                    const typedItems = items.map(item => ({ ...item, type: key }));
                    for (const item of typedItems) {
                        allData.push(item);
                    }
                }
            }

            console.log(`Embedding ${allData.length} items for ${repoName}...`);
            let points = 0;

            // Batch processing
            const BATCH_SIZE = 50;
            for (let i = 0; i < allData.length; i += BATCH_SIZE) {
                const batch = allData.slice(i, i + BATCH_SIZE);
                const pointsToUpsert: any[] = [];

                for (const item of batch) {
                    const { rawSource, ...payload } = item;
                    if (rawSource && rawSource.trim().length > 0) {
                        try {
                            const embedding = await extractor(rawSource, { pooling: 'mean', normalize: true });
                            pointsToUpsert.push({
                                id: randomUUID(),
                                vector: Array.from(embedding.data as Float32Array),
                                payload: payload,
                            });
                        } catch (e) {
                            console.warn(`Failed to embed item:`, e);
                        }
                    }
                }

                if (pointsToUpsert.length > 0) {
                    await qdrantClient.upsert(collectionName, {
                        wait: false,
                        points: pointsToUpsert,
                    });
                    points += pointsToUpsert.length;
                }
                console.log(`Processed ${Math.min(i + BATCH_SIZE, allData.length)}/${allData.length} items...`);
            }
            console.log(`Finished embedding ${repoName}. Total points: ${points}`);
        } else {
            console.log(`Collection ${collectionName} already exists. Using existing DB.`);
        }

        // 2. Query for Target Functions
        console.log(`Querying target functions for ${repoName}...`);

        for (const fileDef of repo.files) {
            const fullFilePath = path.resolve(repoPath, fileDef.path); // path in json is relative to repo root? 
            // The paths in json are like "src/compiler/parser.ts"
            // Wait, in target-functions.json, path is relative to repo.
            // But verify: 
            // target-functions.json: "path": "src/compiler/parser.ts"
            // repoPath: "/.../temp-typescript-repo"
            // fullFilePath should be join(repoPath, fileDef.path).

            // Check if file exists there.
            // Sometimes repo structure might be flatten if we were using the temp-js-repo logic from before, but here we are using the real repo.

            for (const funcName of fileDef.functions) {
                console.log(`Querying for function: ${funcName} in ${fileDef.path}`);
                const funcSource = findFunctionSource(fullFilePath, funcName);

                if (!funcSource) {
                    console.warn(`Could not find source for function ${funcName} in ${fullFilePath}`);
                    continue;
                }

                // Create embedding for query
                const queryEmbedding = await extractor(funcSource, { pooling: 'mean', normalize: true });
                const vector = Array.from(queryEmbedding.data as Float32Array);

                // Search
                const searchResult = await qdrantClient.search(collectionName, {
                    vector: vector,
                    limit: 10,
                    with_payload: true,
                });

                const formattedResults: RetrievalResult[] = searchResult.map(res => ({
                    score: res.score,
                    payload: res.payload
                }));

                allResults.push({
                    repository: repoName,
                    filePath: fileDef.path,
                    functionName: funcName,
                    results: formattedResults
                });
            }
        }
    }

    const outputFilePath = path.join(RESULTS_DIR, 'rq4-results.json');
    fs.writeFileSync(outputFilePath, JSON.stringify(allResults, null, 2));
    console.log(`RQ4 experiment complete. Results saved to ${outputFilePath}`);
}

runExperiment().catch(err => {
    console.error(err);
    process.exit(1);
});
