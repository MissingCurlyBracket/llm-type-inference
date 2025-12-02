import { RAGTypeInference } from "./rag-inference.js";
import { ProviderConfig } from '../provider-config.js';

async function main(): Promise<void> {
    try {
        // Use ProviderConfig helper to get provider from environment or default to OpenAI
        const { config, provider } = ProviderConfig.fromEnv();
        const ragTypeInference = await RAGTypeInference.create(config, provider);

        // Get file path from command line arguments
        const filePath = process.argv[2];
        const topN = process.argv[3] ? parseInt(process.argv[3], 10) : 5;

        if (!filePath) {
            console.error('Usage: npm run rag-infer <file-path> [topN]');
            console.error('');
            console.error('Example: npm run rag-infer sample.js 10');
            console.error('');
            console.error('Tip: Set LLM_PROVIDER=qwen in .env to use Qwen instead of OpenAI');
            process.exit(1);
        }

        console.log(`Analyzing file with RAG approach: ${filePath}`);
        console.log(`Using provider: ${provider}`);
        console.log(`Querying vector database for top ${topN} results...`);
        console.log('Sending results to LLM for type inference...');

        const typeInferences = await ragTypeInference.inferTypesFromFile(filePath, topN);

        console.log('\nRAG-based Type Inference Results:');
        console.log('='.repeat(50));
        console.log(JSON.stringify(typeInferences, null, 2));

        console.log(`\nFound ${typeInferences.results.length} identifiers with inferred types`);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error:', errorMessage);

        if (errorMessage.includes('OPENAI_API_KEY')) {
            console.error('\nMake sure to set your OPENAI_API_KEY in the .env file');
        }

        if (errorMessage.includes('Ollama')) {
            console.error('\nMake sure Ollama is running and the model is installed');
        }

        if (errorMessage.includes('ECONNREFUSED')) {
            console.error('\nMake sure the Qdrant database is running.');
        }

        process.exit(1);
    }
}

main().catch(console.error);
