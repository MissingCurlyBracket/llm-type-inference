import { debounce } from '../utils.js';

export class Button {
    private element: HTMLButtonElement;

    constructor(label: string, onClick: () => void) {
        this.element = document.createElement('button');
        this.element.textContent = label;
        this.element.addEventListener('click', debounce(onClick, 300));
    }

    public render(parentElement: HTMLElement) {
        parentElement.appendChild(this.element);
    }

    public disable() {
        this.element.disabled = true;
    }

    public enable() {
        this.element.disabled = false;
    }
}
