import { pipeline, env, FeatureExtractionPipeline } from '@xenova/transformers';
import { QdrantClient } from '@qdrant/js-client-rest';
import { Embeddings } from 'openai/resources.mjs';

// Allow local models
env.allowLocalModels = true;

const COLLECTION_NAME = 'example-code-embeddings';
const MODEL_NAME = 'Xenova/bert-base-uncased';

let extractor: FeatureExtractionPipeline;
let qdrantClient: QdrantClient;

async function initialize() {
    if (!extractor) {
        console.log(`Loading embedding model (${MODEL_NAME})...`);
        extractor = await pipeline('feature-extraction', MODEL_NAME, { revision: 'default' });
        console.log('Embedding model loaded.');
    }
    if (!qdrantClient) {
        qdrantClient = new QdrantClient({ url: 'http://localhost:6333' });
    }
}

export default async function searchEmbeddings(query: string, limit: number = 5) {
    await initialize();

    if (!extractor || !qdrantClient) {
        throw new Error('Initialization failed.');
    }

    console.log(`Creating embedding for query: "${query}"`);
    const queryEmbedding = await extractor(query, { pooling: 'mean', normalize: true });

    console.log(`Searching for similar embeddings in collection: ${COLLECTION_NAME}`);
    const searchResult = await qdrantClient.search(COLLECTION_NAME, {
        vector: Array.from(queryEmbedding.data as Float32Array),
        limit: limit,
        with_payload: true,
    });

    return searchResult;
}
