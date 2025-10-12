// Simple functions with basic types
function add(a: number, b: number): number {
    return a + b;
}

function greet(name: string): string {
    return `Hello, ${name}!`;
}

function isEven(num: number): boolean {
    return num % 2 === 0;
}

// Variables with explicit types
const message: string = "Hello World";
const count: number = 42;
const isEnabled: boolean = true;

// Array and object types
const numbers: number[] = [1, 2, 3, 4, 5];
const user: { name: string; age: number } = { name: "John", age: 30 };

// Function with complex parameters
function processData(data: string[], threshold: number): string[] {
    return data.filter(item => item.length > threshold);
}