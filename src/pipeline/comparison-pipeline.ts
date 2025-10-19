import { TypeInference } from '../basic-inference/type-inference';
import { ASTTypeInference } from '../ast-inference/ast-type-inference';
import { TypeScriptParser, GroundTruthType } from '../evaluation/typescript-parser';
import { MetricsCalculator } from '../evaluation/evaluation-metrics';
import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface PipelineConfig {
    repositoryUrl: string;
    targetDirectory: string;
    numberOfFiles: number;
    excludePatterns: string[];
    minFileSize: number;
    maxFileSize: number;
    outputDirectory: string;
}

interface ComparisonResult {
    filePath: string;
    fileSize: number;
    groundTruthCount: number;
    traditionalMetrics: any;
    astMetrics: any;
    error?: string;
    duration: number;
}

interface PipelineResults {
    totalFiles: number;
    successfulComparisons: number;
    failedComparisons: number;
    results: ComparisonResult[];
    aggregateMetrics: {
        traditional: {
            averageAccuracy: number;
            averageMRR: number;
            totalCorrect: number;
            totalPredictions: number;
            totalReciprocalRank: number;
        };
        ast: {
            averageAccuracy: number;
            averageMRR: number;
            totalCorrect: number;
            totalPredictions: number;
            totalReciprocalRank: number;
        };
    };
}

export class ComparisonPipeline {
    private config: PipelineConfig;

    constructor(config: Partial<PipelineConfig> = {}) {
        this.config = {
            repositoryUrl: config.repositoryUrl || 'https://github.com/microsoft/TypeScript.git',
            targetDirectory: config.targetDirectory || 'temp-typescript-repo',
            numberOfFiles: config.numberOfFiles || 10,
            excludePatterns: config.excludePatterns || [
                '**/node_modules/**',
                '**/tests/**',
                '**/test/**',
                '**/*.test.ts',
                '**/*.spec.ts',
                '**/built/**',
                '**/lib/**',
                '**/scripts/**'
            ],
            minFileSize: config.minFileSize || 500, // bytes
            maxFileSize: config.maxFileSize || 10000, // bytes
            outputDirectory: config.outputDirectory || 'pipeline-results'
        };
    }

    public async run(): Promise<PipelineResults> {
        console.log('🚀 Starting TypeScript Comparison Pipeline');
        console.log('='.repeat(60));

        const startTime = Date.now();

        try {
            // Step 1: Clone or update TypeScript repository
            await this.setupRepository();

            // Step 2: Find TypeScript files
            const candidateFiles = await this.findTypeScriptFiles();

            // Step 3: Select random files with ground truth types
            const selectedFiles = this.selectRandomFiles(candidateFiles);

            if (selectedFiles.length === 0) {
                throw new Error('No files with ground truth types found in the src directory');
            }

            // Step 4: Run comparisons
            const results = await this.runComparisons(selectedFiles);

            // Step 5: Generate aggregate results
            const pipelineResults = this.aggregateResults(results);

            // Step 6: Save results
            await this.saveResults(pipelineResults);

            // Step 7: Cleanup
            await this.cleanup();

            const duration = Date.now() - startTime;
            console.log(`\n✅ Pipeline completed in ${(duration / 1000).toFixed(2)}s`);

            return pipelineResults;

        } catch (error) {
            console.error('❌ Pipeline failed:', error);
            throw error;
        }
    }

    private async setupRepository(): Promise<void> {
        console.log('\n📁 Setting up TypeScript repository...');

        const repoPath = path.resolve(this.config.targetDirectory);

        if (fs.existsSync(repoPath)) {
            console.log('Repository directory exists, updating...');
            return;
        } else {
            await this.cloneRepository();
        }
    }

    private async cloneRepository(): Promise<void> {
        console.log(`Cloning repository from ${this.config.repositoryUrl}...`);

        const command = `git clone --depth 1 ${this.config.repositoryUrl} ${this.config.targetDirectory}`;

        await execAsync(command);
        console.log('Repository cloned successfully');
    }

    private async findTypeScriptFiles(): Promise<string[]> {
        console.log('\n🔍 Finding TypeScript files in src directory...');

        const repoPath = path.resolve(this.config.targetDirectory);
        const srcPath = path.join(repoPath, 'src');
        const files: string[] = [];

        // Check if src directory exists
        if (!fs.existsSync(srcPath)) {
            console.log(`❌ No 'src' directory found in ${repoPath}`);
            return files;
        }

        const walkDirectory = (dir: string): void => {
            const items = fs.readdirSync(dir);

            for (const item of items) {
                const fullPath = path.join(dir, item);
                const relativePath = path.relative(repoPath, fullPath);

                // Check exclude patterns
                if (this.shouldExclude(relativePath)) {
                    continue;
                }

                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    walkDirectory(fullPath);
                } else if (item.endsWith('.ts') && !item.endsWith('.d.ts')) {
                    // Check file size
                    if (stat.size >= this.config.minFileSize && stat.size <= this.config.maxFileSize) {
                        files.push(fullPath);
                    }
                }
            }
        };

        walkDirectory(srcPath);

        console.log(`Found ${files.length} suitable TypeScript files in src directory`);
        return files;
    }

    private shouldExclude(relativePath: string): boolean {
        return this.config.excludePatterns.some(pattern => {
            const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
            return regex.test(relativePath);
        });
    }

    private selectRandomFiles(files: string[]): string[] {
        console.log(`\n🎲 Selecting ${this.config.numberOfFiles} files with ground truth types...`);

        const shuffled = [...files].sort(() => Math.random() - 0.5);
        const validFiles: string[] = [];
        const parser = new TypeScriptParser();

        // Check files one by one until we have enough valid files
        for (const file of shuffled) {
            if (validFiles.length >= this.config.numberOfFiles) {
                break;
            }

            try {
                const groundTruth = parser.extractGroundTruth(file);
                if (groundTruth.length > 0) {
                    validFiles.push(file);
                    const relativePath = path.relative(this.config.targetDirectory, file);
                    const size = fs.statSync(file).size;
                    console.log(`  ${validFiles.length}. ${relativePath} (${size} bytes, ${groundTruth.length} types)`);
                } else {
                    const relativePath = path.relative(this.config.targetDirectory, file);
                    console.log(`  Skipping ${relativePath} - no ground truth types found`);
                }
            } catch (error) {
                const relativePath = path.relative(this.config.targetDirectory, file);
                console.log(`  Skipping ${relativePath} - error extracting types: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (validFiles.length < this.config.numberOfFiles) {
            console.log(`⚠️  Warning: Only found ${validFiles.length} files with ground truth types out of ${this.config.numberOfFiles} requested`);
        }

        console.log(`\nSelected ${validFiles.length} files for evaluation`);
        return validFiles;
    }

    private async runComparisons(files: string[]): Promise<ComparisonResult[]> {
        console.log('\n⚡ Running comparisons...');

        const results: ComparisonResult[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const relativePath = path.relative(this.config.targetDirectory, file);

            console.log(`\n[${i + 1}/${files.length}] Processing: ${relativePath}`);
            console.log('-'.repeat(50));

            const startTime = Date.now();

            try {
                const result = await this.runSingleComparison(file);
                const duration = Date.now() - startTime;

                results.push({
                    ...result,
                    duration
                });

                console.log(`✅ Completed in ${(duration / 1000).toFixed(2)}s`);

            } catch (error) {
                const duration = Date.now() - startTime;
                const errorMessage = error instanceof Error ? error.message : String(error);

                console.log(`❌ Failed: ${errorMessage}`);

                results.push({
                    filePath: relativePath,
                    fileSize: fs.statSync(file).size,
                    groundTruthCount: 0,
                    traditionalMetrics: null,
                    astMetrics: null,
                    error: errorMessage,
                    duration
                });
            }
        }

        return results;
    }

    private async runSingleComparison(filePath: string): Promise<Omit<ComparisonResult, 'duration'>> {
        const relativePath = path.relative(this.config.targetDirectory, filePath);
        const fileSize = fs.statSync(filePath).size;

        // Extract ground truth (we already verified this file has types in selectRandomFiles)
        const parser = new TypeScriptParser();
        const groundTruth = parser.extractGroundTruth(filePath);

        // This shouldn't happen since we pre-filtered, but double-check
        if (groundTruth.length === 0) {
            throw new Error('No ground truth types found (unexpected - file should have been pre-filtered)');
        }

        // Convert to JavaScript
        const jsCode = parser.convertToJavaScript(filePath);
        const tempJsFile = filePath.replace('.ts', '.temp.js');
        fs.writeFileSync(tempJsFile, jsCode);

        let traditionalMetrics: any = null;
        let astMetrics: any = null;

        try {
            // Run traditional approach with 5 predictions for MRR
            try {
                const traditionalInference = new TypeInference();
                const traditionalResults = await traditionalInference.inferTypesWithMultiplePredictions(jsCode, 5);
                traditionalMetrics = MetricsCalculator.calculateMetrics(traditionalResults, groundTruth);
            } catch (error) {
                console.log(`  Traditional approach failed: ${error instanceof Error ? error.message : String(error)}`);
            }

            // Run AST approach with 5 predictions for MRR
            try {
                const astInference = new ASTTypeInference();
                const astResults = await astInference.inferTypesWithMultiplePredictions(jsCode, 5);
                astMetrics = MetricsCalculator.calculateMetrics(astResults, groundTruth);
            } catch (error) {
                console.log(`  AST approach failed: ${error instanceof Error ? error.message : String(error)}`);
            }

            if (!traditionalMetrics && !astMetrics) {
                throw new Error('Both approaches failed');
            }

            console.log(`  Ground truth: ${groundTruth.length} identifiers`);
            if (traditionalMetrics) {
                console.log(`  Traditional: ${(traditionalMetrics.accuracy * 100).toFixed(1)}% accuracy, ${traditionalMetrics.mrr.toFixed(3)} MRR`);
            }
            if (astMetrics) {
                console.log(`  AST: ${(astMetrics.accuracy * 100).toFixed(1)}% accuracy, ${astMetrics.mrr.toFixed(3)} MRR`);
            }

            return {
                filePath: relativePath,
                fileSize,
                groundTruthCount: groundTruth.length,
                traditionalMetrics,
                astMetrics
            };

        } finally {
            // Clean up temporary file
            if (fs.existsSync(tempJsFile)) {
                fs.unlinkSync(tempJsFile);
            }
        }
    }

    private aggregateResults(results: ComparisonResult[]): PipelineResults {
        console.log('\n📊 Aggregating results...');

        const successful = results.filter(r => !r.error);
        const failed = results.filter(r => r.error);

        const traditionalResults = successful.filter(r => r.traditionalMetrics);
        const astResults = successful.filter(r => r.astMetrics);

        const traditionalStats = this.calculateAggregateMetrics(traditionalResults.map(r => r.traditionalMetrics));
        const astStats = this.calculateAggregateMetrics(astResults.map(r => r.astMetrics));

        const pipelineResults: PipelineResults = {
            totalFiles: results.length,
            successfulComparisons: successful.length,
            failedComparisons: failed.length,
            results,
            aggregateMetrics: {
                traditional: traditionalStats,
                ast: astStats
            }
        };

        this.printSummary(pipelineResults);

        return pipelineResults;
    }

    private calculateAggregateMetrics(metrics: any[]): { averageAccuracy: number; averageMRR: number; totalCorrect: number; totalPredictions: number; totalReciprocalRank: number } {
        if (metrics.length === 0) {
            return { averageAccuracy: 0, averageMRR: 0, totalCorrect: 0, totalPredictions: 0, totalReciprocalRank: 0 };
        }

        const totalCorrect = metrics.reduce((sum, m) => sum + m.correctPredictions, 0);
        const totalPredictions = metrics.reduce((sum, m) => sum + m.totalPredictions, 0);
        const totalReciprocalRank = metrics.reduce((sum, m) => sum + m.totalReciprocalRank, 0);

        const averageAccuracy = totalPredictions > 0 ? totalCorrect / totalPredictions : 0;
        const averageMRR = totalPredictions > 0 ? totalReciprocalRank / totalPredictions : 0;

        return {
            averageAccuracy,
            averageMRR,
            totalCorrect,
            totalPredictions,
            totalReciprocalRank
        };
    }

    private printSummary(results: PipelineResults): void {
        console.log('\n📈 Pipeline Summary');
        console.log('='.repeat(40));
        console.log(`Files evaluated: ${results.totalFiles} (requested: ${this.config.numberOfFiles})`);
        console.log(`Successful comparisons: ${results.successfulComparisons}`);
        console.log(`Failed comparisons: ${results.failedComparisons}`);

        if (results.aggregateMetrics.traditional.totalPredictions > 0) {
            console.log(`\nTraditional Approach:`);
            console.log(`  Average accuracy: ${(results.aggregateMetrics.traditional.averageAccuracy * 100).toFixed(1)}%`);
            console.log(`  Average MRR: ${results.aggregateMetrics.traditional.averageMRR.toFixed(3)}`);
            console.log(`  Total correct: ${results.aggregateMetrics.traditional.totalCorrect}/${results.aggregateMetrics.traditional.totalPredictions}`);
        }

        if (results.aggregateMetrics.ast.totalPredictions > 0) {
            console.log(`\nAST Approach:`);
            console.log(`  Average accuracy: ${(results.aggregateMetrics.ast.averageAccuracy * 100).toFixed(1)}%`);
            console.log(`  Average MRR: ${results.aggregateMetrics.ast.averageMRR.toFixed(3)}`);
            console.log(`  Total correct: ${results.aggregateMetrics.ast.totalCorrect}/${results.aggregateMetrics.ast.totalPredictions}`);
        }

        if (results.aggregateMetrics.traditional.totalPredictions > 0 && results.aggregateMetrics.ast.totalPredictions > 0) {
            const traditionalAcc = results.aggregateMetrics.traditional.averageAccuracy;
            const astAcc = results.aggregateMetrics.ast.averageAccuracy;
            const winner = traditionalAcc > astAcc ? 'Traditional' : 'AST';
            const difference = Math.abs(traditionalAcc - astAcc) * 100;

            console.log(`\n🏆 Winner: ${winner} approach (${difference.toFixed(1)}% better)`);
        }
    }

    private async saveResults(results: PipelineResults): Promise<void> {
        console.log('\n💾 Saving results...');

        // Create output directory
        if (!fs.existsSync(this.config.outputDirectory)) {
            fs.mkdirSync(this.config.outputDirectory, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const resultsFile = path.join(this.config.outputDirectory, `pipeline-results-${timestamp}.json`);

        fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
        console.log(`Results saved to: ${resultsFile}`);

        // Also save a summary report
        const summaryFile = path.join(this.config.outputDirectory, `pipeline-summary-${timestamp}.md`);
        const summaryContent = this.generateSummaryReport(results);
        fs.writeFileSync(summaryFile, summaryContent);
        console.log(`Summary report saved to: ${summaryFile}`);
    }

    private generateSummaryReport(results: PipelineResults): string {
        const timestamp = new Date().toISOString();

        let report = `# TypeScript Comparison Pipeline Results\n\n`;
        report += `**Generated:** ${timestamp}\n`;
        report += `**Repository:** ${this.config.repositoryUrl}\n`;
        report += `**Files Processed:** ${results.totalFiles}\n\n`;

        report += `## Summary\n\n`;
        report += `- ✅ Successful comparisons: ${results.successfulComparisons}\n`;
        report += `- ❌ Failed comparisons: ${results.failedComparisons}\n\n`;

        if (results.aggregateMetrics.traditional.totalPredictions > 0) {
            report += `### Traditional Approach\n`;
            report += `- Average accuracy: ${(results.aggregateMetrics.traditional.averageAccuracy * 100).toFixed(1)}%\n`;
            report += `- Average MRR: ${results.aggregateMetrics.traditional.averageMRR.toFixed(3)}\n`;
            report += `- Total correct: ${results.aggregateMetrics.traditional.totalCorrect}/${results.aggregateMetrics.traditional.totalPredictions}\n\n`;
        }

        if (results.aggregateMetrics.ast.totalPredictions > 0) {
            report += `### AST Approach\n`;
            report += `- Average accuracy: ${(results.aggregateMetrics.ast.averageAccuracy * 100).toFixed(1)}%\n`;
            report += `- Average MRR: ${results.aggregateMetrics.ast.averageMRR.toFixed(3)}\n`;
            report += `- Total correct: ${results.aggregateMetrics.ast.totalCorrect}/${results.aggregateMetrics.ast.totalPredictions}\n\n`;
        }

        report += `## Individual Results\n\n`;

        results.results.forEach((result, index) => {
            report += `### ${index + 1}. ${result.filePath}\n`;
            report += `- File size: ${result.fileSize} bytes\n`;
            report += `- Duration: ${(result.duration / 1000).toFixed(2)}s\n`;

            if (result.error) {
                report += `- ❌ Error: ${result.error}\n`;
            } else {
                report += `- Ground truth: ${result.groundTruthCount} identifiers\n`;

                if (result.traditionalMetrics) {
                    report += `- Traditional: ${(result.traditionalMetrics.accuracy * 100).toFixed(1)}% accuracy, ${result.traditionalMetrics.mrr.toFixed(3)} MRR (${result.traditionalMetrics.correctPredictions}/${result.traditionalMetrics.totalPredictions})\n`;
                }

                if (result.astMetrics) {
                    report += `- AST: ${(result.astMetrics.accuracy * 100).toFixed(1)}% accuracy, ${result.astMetrics.mrr.toFixed(3)} MRR (${result.astMetrics.correctPredictions}/${result.astMetrics.totalPredictions})\n`;
                }
            }

            report += `\n`;
        });

        return report;
    }

    private async cleanup(): Promise<void> {
        console.log('\n🧹 Cleaning up temporary files...');

        // Only clean up .temp.js files, not the repository
        const repoPath = path.resolve(this.config.targetDirectory);
        if (fs.existsSync(repoPath)) {
            this.cleanupTempFiles(repoPath);
            console.log('Temporary files cleaned up');
        }
    }

    private cleanupTempFiles(dirPath: string): void {
        const walkDirectory = (dir: string): void => {
            if (!fs.existsSync(dir)) return;

            const items = fs.readdirSync(dir);

            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    walkDirectory(fullPath);
                } else if (item.endsWith('.temp.js')) {
                    fs.unlinkSync(fullPath);
                }
            }
        };

        walkDirectory(dirPath);
    }

    private async removeDirectory(dirPath: string): Promise<void> {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
    }
}

// CLI interface
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const config: Partial<PipelineConfig> = {};

    // Parse command line arguments
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i];
        const value = args[i + 1];

        switch (key) {
            case '--repo':
                config.repositoryUrl = value;
                break;
            case '--files':
                config.numberOfFiles = parseInt(value);
                break;
            case '--min-size':
                config.minFileSize = parseInt(value);
                break;
            case '--max-size':
                config.maxFileSize = parseInt(value);
                break;
            case '--output':
                config.outputDirectory = value;
                break;
            case '--help':
                printHelp();
                return;
        }
    }

    console.log('Configuration:');
    console.log(JSON.stringify(config, null, 2));

    const pipeline = new ComparisonPipeline(config);
    await pipeline.run();
}

function printHelp(): void {
    console.log(`
TypeScript Comparison Pipeline

Usage: npm run pipeline [options]

Options:
  --repo <url>         Repository URL to clone (default: TypeScript repo)
  --files <number>     Number of files to test (default: 10)
  --min-size <bytes>   Minimum file size (default: 500)
  --max-size <bytes>   Maximum file size (default: 10000)
  --output <dir>       Output directory for results (default: pipeline-results)
  --help               Show this help message

Examples:
  npm run pipeline
  npm run pipeline --files 20 --max-size 5000
  npm run pipeline --repo https://github.com/angular/angular.git --files 5
`);
}

// Run if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}