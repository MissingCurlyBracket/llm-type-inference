import { TypeInference } from './basic-inference/type-inference';
import { ASTTypeInference } from './ast-inference/ast-type-inference';

async function main(): Promise<void> {
    try {
        const filePath = process.argv[2];

        if (!filePath) {
            console.error('Usage: npm run compare <javascript-file-path>');
            console.error('');
            console.error('Example: npm run compare sample.js');
            process.exit(1);
        }

        console.log(`Comparing inference approaches for: ${filePath}`);
        console.log('='.repeat(60));

        // Run traditional source code approach
        console.log('\n1. Traditional Source Code Approach:');
        console.log('Sending raw source code to OpenAI...');

        try {
            const traditionalInference = new TypeInference();
            const traditionalResults = await traditionalInference.inferTypesFromFile(filePath);

            console.log('Results:');
            console.log(JSON.stringify(traditionalResults, null, 2));
            console.log(`Found ${traditionalResults.length} identifiers`);
        } catch (error) {
            console.error('Traditional approach failed:', error instanceof Error ? error.message : String(error));
        }

        // Run AST-based approach
        console.log('\n2. AST-based Approach:');
        console.log('Parsing to AST first, then sending structure to OpenAI...');

        try {
            const astInference = new ASTTypeInference();
            const astResults = await astInference.inferTypesFromFile(filePath);

            console.log('Results:');
            console.log(JSON.stringify(astResults, null, 2));
            console.log(`Found ${astResults.length} identifiers`);
        } catch (error) {
            console.error('AST approach failed:', error instanceof Error ? error.message : String(error));
        }

        console.log('\nComparison completed!');

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error:', errorMessage);

        if (errorMessage.includes('OPENAI_API_KEY')) {
            console.error('\nMake sure to set your OPENAI_API_KEY in the .env file');
        }

        process.exit(1);
    }
}

// Run if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}