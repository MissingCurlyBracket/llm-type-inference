# LLM Type Inference

A TypeScript-based JavaScript to TypeScript type inference tool using OpenAI's language models with two different approaches.

## Features

- **Two Inference Approaches**:
  1. **Traditional**: Direct source code analysis
  2. **AST-based**: Parse to Abstract Syntax Tree first, then analyze structure
- **Automated Comparison Pipeline**: Test approaches on real-world TypeScript repositories
- **TypeScript Implementation**: Fully typed codebase with proper error handling
- **CLI Interface**: Multiple ways to run and compare approaches
- **JSON Output**: Consistent format for both approaches
- **Comprehensive Error Handling**: API failures, parsing errors, and file issues

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up your OpenAI API key in `.env`:
```
OPENAI_API_KEY=your_openai_api_key_here
```

## Usage

### Traditional Source Code Approach
Sends raw JavaScript source code directly to the LLM:
```bash
npm run infer sample.js
```

### AST-based Approach
Parses JavaScript to AST first, then sends structured representation to the LLM:
```bash
npm run ast-infer sample.js
```

### Compare Both Approaches with Ground Truth Evaluation
Run both approaches on a TypeScript file and evaluate against ground truth:
```bash
npm run compare test-samples/simple.ts
npm run compare test-samples/complex.ts
```

### Automated Comparison Pipeline
Run large-scale comparison on real TypeScript repositories:
```bash
# Quick test with 5 files from TypeScript repository
npm run run-pipeline

# Advanced usage with custom settings
npm run pipeline -- --files 20 --min-size 1000 --max-size 8000
```

For detailed pipeline documentation, see [PIPELINE.md](PIPELINE.md).

This will:
1. Extract type annotations from the TypeScript file as ground truth
2. Convert TypeScript to JavaScript (removing type information)
3. Run both inference approaches on the JavaScript code
4. Compare results with ground truth using precision, recall, and F1-score metrics

### Build for Production
```bash
npm run build
```

## Approaches Explained

### 1. Traditional Approach (`src/type-inference.ts`)
- Reads JavaScript source code as plain text
- Sends the raw code directly to OpenAI with type inference instructions
- Relies on the LLM's built-in understanding of JavaScript syntax

### 2. AST-based Approach (`src/ast-type-inference.ts`)
- Parses JavaScript code into an Abstract Syntax Tree using Babel parser
- Extracts structured information about functions, variables, and classes
- Sends the structured AST representation to OpenAI
- Provides more context about code structure, parameters, and relationships

## Output Format

Both approaches return the same JSON format:

```json
[
  {
    "entity": "function",
    "name": "add",
    "types": {
      "params": { "a": "number", "b": "number" },
      "return": "number"
    }
  },
  {
    "entity": "variable", 
    "name": "name",
    "types": {
      "return": "string"
    }
  }
]
```

## Ground Truth Evaluation

The tool now supports rigorous evaluation using TypeScript files as ground truth:

### Process:
1. **Extract Ground Truth**: Parse TypeScript file to extract actual type annotations
2. **Convert to JavaScript**: Remove all type information using TypeScript compiler
3. **Run Inference**: Apply both approaches to the plain JavaScript code
4. **Evaluate**: Compare inferred types with original TypeScript types

### Metrics:
- **Precision**: Percentage of predicted types that are correct
- **Recall**: Percentage of actual types that were correctly predicted  
- **F1-Score**: Harmonic mean of precision and recall
- **Accuracy**: Overall percentage of correct predictions

### Test Samples:
- `test-samples/simple.ts`: Basic functions and variables
- `test-samples/complex.ts`: Classes, interfaces, and advanced types
```javascript
function calculateArea(width, height) {
  return width * height;
}

const PI = 3.14159;
const users = ['Alice', 'Bob', 'Charlie'];

class Calculator {
  constructor(initialValue) {
    this.value = initialValue;
  }
  
  add(num) {
    this.value += num;
    return this;
  }
}
```

Run the comparison:
```bash
npm run compare sample.js
```

## Dependencies

- **Runtime**: `openai`, `dotenv`, `@babel/parser`, `@babel/types`
- **Development**: `typescript`, `ts-node`, `@types/node`, `@types/babel__parser`, `@types/babel__types`

## File Structure

```
src/
├── basic-inference/
│   ├── type-inference.ts      # Traditional approach
│   └── infer.ts              # CLI for traditional approach
├── ast-inference/
│   ├── ast-type-inference.ts  # AST-based approach  
│   └── ast-infer.ts          # CLI for AST approach
├── evaluation/
│   ├── typescript-parser.ts   # Ground truth extraction
│   └── evaluation-metrics.ts  # Metrics calculation
├── pipeline/
│   ├── comparison-pipeline.ts # Automated comparison pipeline
│   └── run-pipeline.ts       # Quick pipeline runner
└── compare.ts                # Compare both approaches on single files
```