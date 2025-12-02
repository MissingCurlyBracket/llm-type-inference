import { AppConfig } from '../config.js';
import { User, Product, Order } from '../types.js';

async function fetchFromApi<T>(endpoint: string): Promise<T> {
    const response = await fetch(endpoint);
    if (!response.ok) {
        throw new Error(`Failed to fetch from ${endpoint}`);
    }
    return response.json() as Promise<T>;
}

export const api = {
    getUsers: (): Promise<User[]> => fetchFromApi<User[]>(AppConfig.apiEndpoints.users),
    getProducts: (): Promise<Product[]> => fetchFromApi<Product[]>(AppConfig.apiEndpoints.products),
    getOrders: (): Promise<Order[]> => fetchFromApi<Order[]>(AppConfig.apiEndpoints.orders),
};
