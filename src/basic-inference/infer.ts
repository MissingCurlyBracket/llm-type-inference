import { TypeInference } from './type-inference.js';
import { ProviderConfig } from '../provider-config.js';

async function main(): Promise<void> {
    try {
        // Use ProviderConfig helper to get provider from environment or default to OpenAI
        const { config, provider } = ProviderConfig.fromEnv();
        const typeInference = await TypeInference.create(config, provider);

        // Get file path from command line arguments
        const filePath = process.argv[2];

        if (!filePath) {
            console.error('Usage: npm run dev <javascript-file-path>');
            console.error('   or: npm start <javascript-file-path>');
            console.error('');
            console.error('Example: npm run dev sample.js');
            console.error('');
            console.error('Tip: Set LLM_PROVIDER=qwen in .env to use Qwen instead of OpenAI');
            process.exit(1);
        }

        console.log(`Analyzing file: ${filePath}`);
        console.log(`Using provider: ${provider}`);
        console.log('Sending to LLM for type inference...');

        const typeInferences = await typeInference.inferTypesFromFile(filePath);

        console.log('\nType Inference Results:');
        console.log('='.repeat(50));
        console.log(JSON.stringify(typeInferences, null, 2));

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error:', errorMessage);

        if (errorMessage.includes('OPENAI_API_KEY')) {
            console.error('\nMake sure to set your OPENAI_API_KEY in the .env file');
        }

        if (errorMessage.includes('Ollama')) {
            console.error('\nMake sure Ollama is running and the model is installed');
            console.error('Install with: ollama pull qwen2.5-coder:20b');
        }

        process.exit(1);
    }
}

main().catch(console.error);
