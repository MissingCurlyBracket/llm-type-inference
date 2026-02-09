import { SyntestTypeInference } from './syntest-type-inference.js';

async function main(): Promise<void> {
    try {
        const filePath = process.argv[2];

        if (!filePath) {
            console.error('Usage: npm run syntest-infer <javascript-file-path>');
            console.error('');
            console.error('Example: npm run syntest-infer sample.js');
            process.exit(1);
        }

        console.log(`Analyzing file: ${filePath}`);
        console.log('Running SynTest probabilistic type inference (proportional ranking)...');

        const inference = await SyntestTypeInference.create();
        const response = await inference.inferTypesFromFile(filePath);

        console.log('\nType Inference Results:');
        console.log('='.repeat(50));
        console.log(JSON.stringify(response.results, null, 2));
        console.log(`\nTotal identifiers: ${response.results.length}`);
        console.log(`Prompt tokens: ${response.promptTokens} (no LLM used)`);
    } catch (error) {
        if (error instanceof Error) {
            console.error('Error:', error.message);
            console.error(error.stack);
        } else {
            console.error('Error:', String(error));
        }
        process.exit(1);
    }
}

main().catch(console.error);
