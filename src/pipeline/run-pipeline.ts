#!/usr/bin/env node

import { ComparisonPipeline } from './comparison-pipeline.js';

async function runPipeline() {
    const pipeline = new ComparisonPipeline({
        numberOfFiles: 5, // Start with a smaller number for testing
        minFileSize: 300,
        maxFileSize: 5000
    });

    try {
        await pipeline.run();
    } catch (error) {
        console.error('Pipeline failed:', error);
        process.exit(1);
    }
}

runPipeline();