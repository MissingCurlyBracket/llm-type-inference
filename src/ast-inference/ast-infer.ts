import { ASTTypeInference } from "./ast-type-inference";
import { ProviderConfig } from '../provider-config';

async function main(): Promise<void> {
    try {
        // Use ProviderConfig helper to get provider from environment or default to OpenAI
        const { config, provider } = ProviderConfig.fromEnv();
        const astTypeInference = new ASTTypeInference(config, provider);

        // Get file path from command line arguments
        const filePath = process.argv[2];

        if (!filePath) {
            console.error('Usage: npm run ast-infer <javascript-file-path>');
            console.error('');
            console.error('Example: npm run ast-infer sample.js');
            console.error('');
            console.error('Tip: Set LLM_PROVIDER=qwen in .env to use Qwen instead of OpenAI');
            process.exit(1);
        }

        console.log(`Analyzing file with AST approach: ${filePath}`);
        console.log(`Using provider: ${provider}`);
        console.log('Parsing JavaScript code to AST...');
        console.log('Sending AST structure to LLM for type inference...');

        const typeInferences = await astTypeInference.inferTypesFromFile(filePath);

        console.log('\nAST-based Type Inference Results:');
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
            console.error('Install with: ollama pull qwen2.5-coder:20b');
        }

        if (errorMessage.includes('Failed to parse JavaScript code')) {
            console.error('\nMake sure the JavaScript file has valid syntax');
        }

        process.exit(1);
    }
}

// Run if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}