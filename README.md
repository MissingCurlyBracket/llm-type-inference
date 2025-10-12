# LLM Type Inference

A TypeScript-based JavaScript to TypeScript type inference tool using OpenAI's language models with two different approaches.

## Features

- **Two Inference Approaches**:
  1. **Traditional**: Direct source code analysis
  2. **AST-based**: Parse to Abstract Syntax Tree first, then analyze structure
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

### Compare Both Approaches
Run both approaches on the same file and see the differences:
```bash
npm run compare sample.js
```

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

## Example

Given this JavaScript code (`sample.js`):
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
├── type-inference.ts      # Traditional approach
├── ast-type-inference.ts  # AST-based approach  
├── infer.ts              # CLI for traditional approach
├── ast-infer.ts          # CLI for AST approach
└── compare.ts            # Compare both approaches
```