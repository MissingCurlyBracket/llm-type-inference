import { TypeInference } from './basic-inference/type-inference.js';
import { ASTTypeInference } from './ast-inference/ast-type-inference.js';
import { TypeScriptParser, GroundTruthType } from './evaluation/typescript-parser.js';
import { MetricsCalculator } from './evaluation/evaluation-metrics.js';
import { ProviderConfig } from './provider-config.js';
import * as fs from 'fs';

async function main(): Promise<void> {
    try {
        const filePath = process.argv[2];

        if (!filePath) {
            console.error('Usage: npm run compare <typescript-file-path>');
            console.error('');
            console.error('Example: npm run compare test-samples/simple.ts');
            process.exit(1);
        }

        // Check if file exists and is a TypeScript file
        if (!fs.existsSync(filePath)) {
            console.error(`Error: File not found: ${filePath}`);
            process.exit(1);
        }

        if (!filePath.endsWith('.ts')) {
            console.error('Error: Please provide a TypeScript file (.ts extension)');
            process.exit(1);
        }

        console.log(`Ground Truth Evaluation for: ${filePath}`);
        console.log('='.repeat(60));

        // Step 1: Parse TypeScript file to extract ground truth types
        console.log('\n1. Extracting Ground Truth from TypeScript...');
        const parser = new TypeScriptParser();
        const groundTruth = parser.extractGroundTruth(filePath);

        console.log(`Ground truth extracted: ${groundTruth.length} identifiers`);
        console.log('Ground truth types:');
        groundTruth.forEach(gt => {
            console.log(`  - ${gt.entity} '${gt.name}': ${JSON.stringify(gt.types)}`);
        });

        // Step 2: Convert TypeScript to JavaScript
        console.log('\n2. Converting TypeScript to JavaScript...');
        const jsCode = parser.convertToJavaScript(filePath);
        const tempJsFile = filePath.replace('.ts', '.temp.js');
        fs.writeFileSync(tempJsFile, jsCode);
        console.log(`JavaScript version created: ${tempJsFile}`);

        try {
            // Get provider configuration from environment
            const { config, provider } = ProviderConfig.fromEnv();

            // Step 3: Run traditional source code approach
            console.log('\n3. Traditional Source Code Approach:');
            console.log('Sending raw JavaScript code to LLM...');

            let traditionalResults: any[] = [];
            let traditionalMetrics: any = null;
            let traditionalPromptTokens: number = 0;

            try {
                const traditionalInference = await TypeInference.create(config, provider);
                const response = await traditionalInference.inferTypesFromFile(tempJsFile);
                traditionalResults = response.results;
                traditionalPromptTokens = response.promptTokens;
                traditionalMetrics = MetricsCalculator.calculateMetrics(traditionalResults, groundTruth);

                console.log('Results:');
                console.log(JSON.stringify(traditionalResults, null, 2));
                console.log(`\nMetrics:`);
                printMetrics('Traditional', traditionalMetrics, traditionalPromptTokens);
            } catch (error) {
                console.error('Traditional approach failed:', error instanceof Error ? error.message : String(error));
            }

            // Step 4: Run AST-based approach
            console.log('\n4. AST-based Approach:');
            console.log('Parsing to AST first, then sending structure to LLM...');

            let astResults: any[] = [];
            let astMetrics: any = null;
            let astPromptTokens: number = 0;

            try {
                const astInference = await ASTTypeInference.create(config, provider);
                const response = await astInference.inferTypesFromFile(tempJsFile);
                astResults = response.results;
                astPromptTokens = response.promptTokens;
                astMetrics = MetricsCalculator.calculateMetrics(astResults, groundTruth);

                console.log('Results:');
                console.log(JSON.stringify(astResults, null, 2));
                console.log(`\nMetrics:`);
                printMetrics('AST', astMetrics, astPromptTokens);
            } catch (error) {
                console.error('AST approach failed:', error instanceof Error ? error.message : String(error));
            }

            // Step 5: Detailed comparison
            if (traditionalMetrics && astMetrics) {
                console.log('\n5. Approach Comparison:');
                console.log('='.repeat(40));
                console.log(`Better Accuracy: ${traditionalMetrics.accuracy > astMetrics.accuracy ? 'Traditional' : 'AST'} (${Math.max(traditionalMetrics.accuracy, astMetrics.accuracy).toFixed(3)} vs ${Math.min(traditionalMetrics.accuracy, astMetrics.accuracy).toFixed(3)})`);
                console.log(`Better MRR: ${traditionalMetrics.mrr > astMetrics.mrr ? 'Traditional' : 'AST'} (${Math.max(traditionalMetrics.mrr, astMetrics.mrr).toFixed(3)} vs ${Math.min(traditionalMetrics.mrr, astMetrics.mrr).toFixed(3)})`);

                if (traditionalPromptTokens > 0 && astPromptTokens > 0) {
                    console.log(`Prompt Tokens: Traditional ${traditionalPromptTokens.toLocaleString()} vs AST ${astPromptTokens.toLocaleString()} (${traditionalPromptTokens > astPromptTokens ? 'AST' : 'Traditional'} more efficient)`);
                }
                // Detailed analysis for traditional approach
                if (traditionalResults.length > 0) {
                    console.log('\n6. Traditional Approach - Detailed Analysis:');
                    const traditionalComparison = MetricsCalculator.generateDetailedComparison(traditionalResults, groundTruth);
                    printDetailedComparison(traditionalComparison);
                }

                // Detailed analysis for AST approach
                if (astResults.length > 0) {
                    console.log('\n7. AST Approach - Detailed Analysis:');
                    const astComparison = MetricsCalculator.generateDetailedComparison(astResults, groundTruth);
                    printDetailedComparison(astComparison);
                }
            }

        } finally {
            // Clean up temporary JavaScript file
            if (fs.existsSync(tempJsFile)) {
                fs.unlinkSync(tempJsFile);
                console.log(`\nCleaned up temporary file: ${tempJsFile}`);
            }
        }

        console.log('\nEvaluation completed!');

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error:', errorMessage);

        if (errorMessage.includes('OPENAI_API_KEY')) {
            console.error('\nMake sure to set your OPENAI_API_KEY in the .env file');
        }

        process.exit(1);
    }
}

function printMetrics(approach: string, metrics: any, promptTokens?: number): void {
    console.log(`  Accuracy: ${(metrics.accuracy * 100).toFixed(1)}%`);
    console.log(`  MRR: ${metrics.mrr.toFixed(3)}`);
    console.log(`  Correct: ${metrics.correctPredictions}/${metrics.totalPredictions}`);
    if (promptTokens !== undefined && promptTokens > 0) {
        console.log(`  Prompt tokens: ${promptTokens.toLocaleString()}`);
    }
}

function printDetailedComparison(comparison: any[]): void {
    const correct = comparison.filter(c => c.status === 'correct');
    const incorrect = comparison.filter(c => c.status === 'incorrect');
    const missing = comparison.filter(c => c.status === 'missing');
    const extra = comparison.filter(c => c.status === 'extra');

    console.log(`  Correct (${correct.length}):`);
    correct.forEach(c => console.log(`    ✓ ${c.identifier}`));

    if (incorrect.length > 0) {
        console.log(`  Incorrect (${incorrect.length}):`);
        incorrect.forEach(c => console.log(`    ✗ ${c.identifier}: ${c.details}`));
    }

    if (missing.length > 0) {
        console.log(`  Missing (${missing.length}):`);
        missing.forEach(c => console.log(`    - ${c.identifier}: ${c.details}`));
    }

    if (extra.length > 0) {
        console.log(`  Extra (${extra.length}):`);
        extra.forEach(c => console.log(`    + ${c.identifier}: ${c.details}`));
    }
}

main().catch(console.error);