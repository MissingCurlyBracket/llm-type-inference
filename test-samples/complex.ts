// More complex example with classes and interfaces

interface Person {
    name: string;
    age: number;
    email?: string;
}

class AdvancedCalculator {
    private history: number[];

    constructor(initialValue: number) {
        this.history = [initialValue];
    }

    add(value: number): number {
        const result = this.history[this.history.length - 1] + value;
        this.history.push(result);
        return result;
    }

    getHistory(): number[] {
        return [...this.history];
    }

    clear(): void {
        this.history = [0];
    }
}

function findPerson(people: Person[], name: string): Person | undefined {
    return people.find(person => person.name === name);
}

const asyncFunction = async (id: number): Promise<string> => {
    return `Result for ${id}`;
};

// Arrow functions
const multiply = (x: number, y: number): number => x * y;
const createUser = (name: string, age: number): Person => ({ name, age });