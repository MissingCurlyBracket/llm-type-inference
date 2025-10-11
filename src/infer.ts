import { TypeInference } from './type-inference';

async function main(): Promise<void> {
    try {
        const typeInference = new TypeInference();

        // Get file path from command line arguments
        const filePath = process.argv[2];

        if (!filePath) {
            console.error('Usage: npm run dev <javascript-file-path>');
            console.error('   or: npm start <javascript-file-path>');
            console.error('');
            console.error('Example: npm run dev sample.js');
            process.exit(1);
        }

        console.log(`🔍 Analyzing file: ${filePath}`);
        console.log('📤 Sending to OpenAI for type inference...');

        const typeInferences = await typeInference.inferTypesFromFile(filePath);

        console.log('\n✅ Type Inference Results:');
        console.log('='.repeat(50));
        console.log(JSON.stringify(typeInferences, null, 2));

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Error:', errorMessage);

        if (errorMessage.includes('OPENAI_API_KEY')) {
            console.error('\n💡 Make sure to set your OPENAI_API_KEY in the .env file');
        }

        process.exit(1);
    }
}

// Run if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}