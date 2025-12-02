import * as fs from 'fs';
import searchEmbeddings from '../src/vector-querying/query.js';

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Please provide a file path as an argument.');
        process.exit(1);
    }

    try {
        const queryText = fs.readFileSync(filePath, 'utf-8');
        console.log(`Querying with text from: ${filePath}`);

        const results = await searchEmbeddings(queryText);

        console.log('Search results:');
        console.log(JSON.stringify(results, null, 2));
    } catch (error) {
        console.error('An error occurred:', error);
        process.exit(1);
    }
}

main();
