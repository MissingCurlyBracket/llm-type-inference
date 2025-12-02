import { User } from '../types.js';
import { api } from '../services/api.js';
import { logger } from '../services/logger.js';

export class UserProfile {
    private element: HTMLDivElement;

    constructor(private userId: string) {
        this.element = document.createElement('div');
        this.element.className = 'user-profile';
    }

    public async render(parentElement: HTMLElement) {
        parentElement.appendChild(this.element);
        try {
            const users = await api.getUsers();
            const user = users.find(u => u.id === this.userId);
            if (user) {
                this.renderUser(user);
            } else {
                this.renderError(`User with id ${this.userId} not found.`);
            }
        } catch (error) {
            logger.error('Failed to fetch user profile:', error);
            this.renderError('Failed to load user profile.');
        }
    }

    private renderUser(user: User) {
        this.element.innerHTML = `
            <h2>${user.firstName} ${user.lastName}</h2>
            <p>Email: ${user.email}</p>
            <p>Username: ${user.username}</p>
            <p>Member since: ${user.createdAt.toLocaleDateString()}</p>
        `;
    }

    private renderError(message: string) {
        this.element.innerHTML = `<p class="error">${message}</p>`;
    }
}
