import { QdrantClient } from '@qdrant/js-client-rest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { extractInformationFromDirectory } from '../information-extraction/index.js';
import { env, pipeline } from '@xenova/transformers';
import * as fs from 'fs';
import * as ts from 'typescript';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allow local models
env.allowLocalModels = true;

const COLLECTION_NAME = 'example-code-embeddings';

async function run() {
    const tempDir = path.resolve(__dirname, '../../temp-js-repo');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }

    try {
        console.log('Transpiling TypeScript to JavaScript...');
        const tsFiles = glob.sync(path.resolve(__dirname, '../../temp-example-repo/**/*.ts'));

        for (const tsFilePath of tsFiles) {
            const sourceCode = fs.readFileSync(tsFilePath, 'utf-8');
            const result = ts.transpileModule(sourceCode, {
                compilerOptions: { module: ts.ModuleKind.CommonJS }
            });
            const jsFilePath = path.join(tempDir, path.basename(tsFilePath).replace('.ts', '.js'));
            fs.writeFileSync(jsFilePath, result.outputText);
        }
        console.log('Transpilation complete.');

        console.log('Starting information extraction...');
        const extractedInfo = extractInformationFromDirectory(tempDir);
        console.log('Information extraction complete.');

        console.log('Loading embedding model...');
        // The model will be downloaded and cached locally on first run.
        const extractor = await pipeline('feature-extraction', 'Xenova/bert-base-uncased', { revision: 'default' });
        console.log('Embedding model loaded.');

        const qdrantClient = new QdrantClient({ url: 'http://localhost:6333' });

        const collectionName = 'temp-example-repo';
        const collections = await qdrantClient.getCollections();
        const collectionExists = collections.collections.some((c: any) => c.name === collectionName);

        if (!collectionExists) {
            console.log(`Creating Qdrant collection: ${collectionName}`);
            await qdrantClient.recreateCollection(collectionName, {
                vectors: {
                    size: 768,
                    distance: 'Cosine',
                },
            });
            console.log('Qdrant collection created.');

            let totalPoints = 0;
            const allData = [];

            for (const key of Object.keys(extractedInfo)) {
                const items = extractedInfo[key as keyof typeof extractedInfo];
                if (Array.isArray(items)) {
                    allData.push(...items.map(item => ({ ...item, type: key })));
                }
            }

            console.log(`Found ${allData.length} code snippets to embed.`);

            for (let i = 0; i < allData.length; i++) {
                const item = allData[i];
                const { rawSource, ...payload } = item;

                if (rawSource && rawSource.trim().length > 0) {
                    const embedding = await extractor(rawSource, { pooling: 'mean', normalize: true });

                    await qdrantClient.upsert(collectionName, {
                        wait: false,
                        points: [
                            {
                                id: randomUUID(),
                                vector: Array.from(embedding.data as Float32Array),
                                payload: payload,
                            },
                        ],
                    });
                    totalPoints++;
                }

                if ((i + 1) % 100 === 0) {
                    console.log(`Embedded and stored ${i + 1}/${allData.length} snippets...`);
                }
            }
            console.log(`\nEmbedding and storage complete. Total points in collection: ${totalPoints}`);
        } else {
            console.log(`Collection ${collectionName} already exists. Using existing DB.`);
        }
    } finally {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            console.log('Temporary directory cleaned up.');
        }
    }
}

run().catch(err => {
    console.error('An error occurred during the embedding pipeline:', err);
    process.exit(1);
});
