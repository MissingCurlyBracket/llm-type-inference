export interface User {
    id: string;
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    createdAt: Date;
}

export interface Product {
    id: string;
    name: string;
    description: string;
    price: number;
    inStock: boolean;
}

export interface Order {
    id: string;
    userId: string;
    productId: string;
    quantity: number;
    orderDate: Date;
}
