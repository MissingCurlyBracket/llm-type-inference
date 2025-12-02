import { UserProfile } from './components/UserProfile.js';
import { ProductList } from './components/ProductList.js';
import { logger } from './services/logger.js';
import { AppConfig } from './config.js';

class App {
    private rootElement: HTMLElement;

    constructor(rootElementId: string) {
        const element = document.getElementById(rootElementId);
        if (!element) {
            throw new Error(`Root element with id '${rootElementId}' not found.`);
        }
        this.rootElement = element;
    }

    public start() {
        logger.info(`Starting ${AppConfig.appName} v${AppConfig.version}`);
        this.renderLayout();

        const userProfile = new UserProfile('1');
        const productList = new ProductList();

        const userProfileContainer = this.rootElement.querySelector('#user-profile-container');
        const productListContainer = this.rootElement.querySelector('#product-list-container');

        if (userProfileContainer instanceof HTMLElement) {
            userProfile.render(userProfileContainer);
        }

        if (productListContainer instanceof HTMLElement) {
            productList.render(productListContainer);
        }
    }

    private renderLayout() {
        this.rootElement.innerHTML = `
            <header>
                <h1>${AppConfig.appName}</h1>
            </header>
            <main>
                <div id="user-profile-container"></div>
                <div id="product-list-container"></div>
            </main>
            <footer>
                <p>&copy; 2025 ${AppConfig.appName}</p>
            </footer>
        `;
    }
}

const app = new App('app');
app.start();
