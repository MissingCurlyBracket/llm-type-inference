
import { pipeline, env } from '@xenova/transformers';
import { QdrantClient } from '@qdrant/js-client-rest';
import * as path from 'path';
import { extractInformationFromDirectory } from '../information-extraction/index.js';

// Allow local models
env.allowLocalModels = true;

const COLLECTION_NAME = 'typescript-code-embeddings';

async function run() {
    console.log('Starting information extraction...');
    const extractedInfo = extractInformationFromDirectory(path.resolve(__dirname, '../../temp-typescript-repo/src'));
    console.log('Information extraction complete.');

    console.log('Loading embedding model (microsoft/unixcoder-base)...');
    // The model will be downloaded and cached locally on first run.
    const extractor = await pipeline('feature-extraction', 'microsoft/unixcoder-base');
    console.log('Embedding model loaded.');

    const qdrantClient = new QdrantClient({ url: 'http://localhost:6333' });

    console.log(`Creating Qdrant collection: ${COLLECTION_NAME}`);
    await qdrantClient.recreateCollection(COLLECTION_NAME, {
        vectors: {
            size: 768, // unixcoder-base has 768 dimensions
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

            await qdrantClient.upsert(COLLECTION_NAME, {
                wait: false,
                points: [
                    {
                        id: `${item.location.file}-${item.location.start.line}-${item.location.start.column}`,
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
}

run().catch(err => {
    console.error('An error occurred during the embedding pipeline:', err);
    process.exit(1);
});
