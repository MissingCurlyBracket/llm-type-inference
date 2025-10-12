import { ASTTypeInference } from "./ast-type-inference";

async function main(): Promise<void> {
    try {
        const astTypeInference = new ASTTypeInference();

        // Get file path from command line arguments
        const filePath = process.argv[2];

        if (!filePath) {
            console.error('Usage: npm run ast-infer <javascript-file-path>');
            console.error('');
            console.error('Example: npm run ast-infer sample.js');
            process.exit(1);
        }

        console.log(`Analyzing file with AST approach: ${filePath}`);
        console.log('Parsing JavaScript code to AST...');
        console.log('Sending AST structure to OpenAI for type inference...');

        const typeInferences = await astTypeInference.inferTypesFromFile(filePath);

        console.log('\nAST-based Type Inference Results:');
        console.log('='.repeat(50));
        console.log(JSON.stringify(typeInferences, null, 2));

        console.log(`\nFound ${typeInferences.length} identifiers with inferred types`);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error:', errorMessage);

        if (errorMessage.includes('OPENAI_API_KEY')) {
            console.error('\nMake sure to set your OPENAI_API_KEY in the .env file');
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