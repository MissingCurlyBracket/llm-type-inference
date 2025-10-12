// Test file to demonstrate the differences between traditional and AST-based inference
function complexFunction(data, options = {}) {
  const { threshold = 10, multiplier = 2 } = options;
  
  if (Array.isArray(data)) {
    return data
      .filter(item => item > threshold)
      .map(item => item * multiplier);
  }
  
  return data * multiplier;
}

const userPreferences = {
  theme: 'dark',
  notifications: true,
  maxItems: 50
};

class DataProcessor {
  constructor(config) {
    this.config = config;
    this.cache = new Map();
  }
  
  process(input) {
    if (this.cache.has(input)) {
      return this.cache.get(input);
    }
    
    const result = this.transform(input);
    this.cache.set(input, result);
    return result;
  }
  
  transform(data) {
    return data.toString().toUpperCase();
  }
}

const processor = new DataProcessor({ verbose: true });
const results = complexFunction([1, 5, 15, 25], { threshold: 10 });