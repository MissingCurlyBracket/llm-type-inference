import { Product } from '../types.js';
import { api } from '../services/api.js';
import { logger } from '../services/logger.js';
import { Button } from './Button.js';

export class ProductList {
    private element: HTMLDivElement;
    private products: Product[] = [];

    constructor() {
        this.element = document.createElement('div');
        this.element.className = 'product-list';
    }

    public async render(parentElement: HTMLElement) {
        parentElement.appendChild(this.element);
        try {
            this.products = await api.getProducts();
            this.renderProducts();
        } catch (error) {
            logger.error('Failed to fetch products:', error);
            this.element.innerHTML = '<p class="error">Failed to load products.</p>';
        }
    }

    private renderProducts() {
        this.element.innerHTML = '<h2>Products</h2>';
        const list = document.createElement('ul');
        this.products.forEach(product => {
            const listItem = document.createElement('li');
            listItem.innerHTML = `
                <strong>${product.name}</strong> - $${product.price.toFixed(2)}
                <p>${product.description}</p>
            `;
            const addToCartButton = new Button('Add to Cart', () => {
                logger.info(`Added ${product.name} to cart.`);
            });
            const buttonContainer = document.createElement('div');
            addToCartButton.render(buttonContainer);
            listItem.appendChild(buttonContainer);
            list.appendChild(listItem);
        });
        this.element.appendChild(list);
    }
}
