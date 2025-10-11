// Sample JavaScript code for type inference testing
function calculateArea(width, height) {
  return width * height;
}

function greetUser(name, age) {
  const greeting = `Hello ${name}, you are ${age} years old!`;
  return greeting;
}

const PI = 3.14159;
let counter = 0;
const users = ['Alice', 'Bob', 'Charlie'];

class Calculator {
  constructor(initialValue) {
    this.value = initialValue;
  }
  
  add(num) {
    this.value += num;
    return this;
  }
  
  getResult() {
    return this.value;
  }
}

const isActive = true;
const config = {
  timeout: 5000,
  retries: 3
};