# LLM Type Inference

A TypeScript-based JavaScript to TypeScript type inference tool using LLMs (Local and Cloud) with three different approaches.

## Features

- **Multiple LLM Providers**:
  - **Cloud**: GPT-4, GPT-3.5-turbo, GPT-5 mini
  - **Local**: qwen3-coder:30b, qwen-3:30b, qwen-2.5-coder:32b, deepseek-r1:32b, starcoder-2:15b
  - Easy switching between providers
- **Two Inference Approaches**:
  1. **Source File**: Direct source code analysis
  2. **AST**: Parse to Abstract Syntax Tree first, then analyze structure
  3. **RAG**: Embedd a project's code snippets into a vector database and query the database for relevant context
- **Automated Comparison Pipeline**: Test approaches on real-world TypeScript repositories
- **TypeScript Implementation**: Fully typed codebase with proper error handling
- **CLI Interface**: Multiple ways to run and compare approaches
- **JSON Output**: Consistent format for both approaches

## Setup

1. Install dependencies:
```bash
npm install
```

2. Choose your LLM provider:

### Option A: OpenAI (Cloud)
Set up your OpenAI API key in `.env`:
```
OPENAI_API_KEY=your_openai_api_key_here
```

### Option B: Ollama (Local)
```bash
# Install Ollama
brew install ollama

# Pull the Qwen model (with Qwen 3 Coder for example)
ollama pull qwen3-coder:30b

# Optionally set provider in .env
LLM_PROVIDER=qwen
```

See [QWEN_PROVIDER.md](QWEN_PROVIDER.md) for detailed setup instructions.

## Usage

### Source File Approach
Sends raw JavaScript source code directly to the LLM:
```bash
npm run infer sample.js
```

### AST Approach
Parses JavaScript to AST first, then sends structured representation to the LLM:
```bash
npm run ast-infer sample.js
```

### RAG Approach
Embeds project snippets into a vector database as part of a one-time setup stage. Querries the database with the function under test for relevant context which is passed to the LLM:
```bash
npm run rag-infer sample.js
```

### Compare The Approaches with Ground Truth Evaluation
Run all approaches on a TypeScript file and evaluate against ground truth:
```bash
npm run compare test-samples/simple.ts
npm run compare test-samples/complex.ts
```

### Provider Comparison Example
Run both OpenAI and Local providers side-by-side:
```bash
npm run example
```

### Automated Comparison Pipeline
Run large-scale comparison on real TypeScript repositories:
```bash
# Quick test with 5 files from TypeScript repository
npm run run-pipeline

# Advanced usage with custom settings
npm run pipeline -- --files 20 --min-size 1000 --max-size 8000
```

This will:
1. Extract type annotations from the TypeScript file as ground truth
2. Convert TypeScript to JavaScript (removing type information)
3. Run all inference approaches on the JavaScript code
4. Compare results with ground truth using accuracy and MRR metrics

## Output Format

All approaches return the same JSON format:

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

The tool supports rigorous evaluation using TypeScript files as ground truth:

### Process:
1. **Extract Ground Truth**: Parse TypeScript file to extract actual type annotations
2. **Convert to JavaScript**: Remove all type information using TypeScript compiler
3. **Run Inference**: Apply both approaches to the plain JavaScript code
4. **Evaluate**: Compare inferred types with original TypeScript types

### Metrics:
- **Top-1 through Top-5 Accuracy**: Overall percentage of correct predictions
- **MRR**: Constructed from the top-1 through top-5 accuracies. Shows the average rank where the correct repsonse can be expected.

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

## LLM Provider Support

This project supports multiple LLM providers that can be easily interchanged:

### OpenAI Provider
- Models: GPT-4, GPT-3.5-turbo, GPT-5 mini
- Requires: API key
- Cost: Pay per token
- Setup: Add `OPENAI_API_KEY` to `.env`

### Local Providers (via Ollama)
- Model: qwen3-coder:30b, qwen-3:30b, qwen-2.5-coder:32b, deepseek-r1:32b, starcoder-2:15b
- Requires: Ollama installed locally
- Cost: Free
- Setup: `ollama pull <model>:<parameter_size>`

### Switching Providers

**Method 1: Direct instantiation**
```typescript
import { TypeInference } from './src/basic-inference/type-inference';

// OpenAI
const openai = new TypeInference({ model: 'gpt-4' }, 'openai');

// Qwen
const qwen = new TypeInference({ model: 'qwen3-coder:30b' }, 'qwen');
```

**Method 2: Using ProviderConfig helper**
```typescript
import { TypeInference } from './src/basic-inference/type-inference';
import { ProviderConfig } from './src/provider-config';

const { config, provider } = ProviderConfig.qwen();
const inference = new TypeInference(config, provider);
```

**Method 3: Environment variable**
```bash
# In .env
LLM_PROVIDER=qwen  # or 'openai'
```

```typescript
import { ProviderConfig } from './src/provider-config';

const { config, provider } = ProviderConfig.fromEnv();
const inference = new TypeInference(config, provider);
```

## File Structure

```text
.
├── ast-infer/                  # AST fixtures and intermediate outputs
├── experiments/                # Experiment inputs and target function lists
├── pipeline-results/           # Generated pipeline reports and summaries
├── scripts/                    # Utility scripts
├── src/                        # Main TypeScript source code
│   ├── ast-inference/          # AST-based inference approach
│   ├── basic-inference/        # Direct source-file inference approach
│   ├── evaluation/             # Ground truth extraction and metrics
│   ├── information-extraction/ # Parsing and extraction helpers
│   ├── llm/                    # LLM provider abstractions and adapters
│   ├── pipeline/               # Comparison and embedding pipelines
│   ├── rag-inference/          # Retrieval-augmented inference approach
│   ├── syntest-inference/      # Syntest-based inference approach
│   └── vector-querying/        # Vector database query helpers
├── syntest-type-inference/     # Vendored Syntest dependency sources
├── temp-example-repo/          # Small sample app used for experiments
└── test-samples/               # TypeScript files used for evaluation
```
