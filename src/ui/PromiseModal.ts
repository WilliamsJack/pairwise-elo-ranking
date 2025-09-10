import { App, FuzzySuggestModal, Modal } from 'obsidian';

// Base for standard Modals that return a value via a Promise.
export class BasePromiseModal<T> extends Modal {
  protected resolver?: (value?: T) => void;
  protected _resolved = false;

  constructor(app: App) {
    super(app);
  }

  openAndGetValue(): Promise<T | undefined> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  finish(value?: T) {
    if (this._resolved) return;
    this._resolved = true;
    const r = this.resolver;
    this.resolver = undefined;
    try {
      r?.(value);
    } finally {
      this.close();
    }
  }

  onClose(): void {
    if (!this._resolved) {
      this.finish(undefined);
    }
  }
}

// Base for FuzzySuggestModal that returns a value via a Promise.
export abstract class BasePromiseFuzzyModal<T> extends FuzzySuggestModal<T> {
  protected resolver?: (value?: T) => void;
  protected _resolved = false;

  constructor(app: App) {
    super(app);
  }

  abstract getItems(): T[];
  abstract getItemText(item: T): string;

  openAndGetValue(): Promise<T | undefined> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  protected finish(value?: T) {
    if (this._resolved) return;
    this._resolved = true;
    const r = this.resolver;
    this.resolver = undefined;
    try {
      r?.(value);
    } finally {
      this.close();
    }
  }

  // Default behaviour: selecting an item completes the promise with that item.
  onChooseItem(item: T): void {
    this.finish(item);
  }

  // Use a microtask delay to avoid racing selection/close flows.
  onClose(): void {
    setTimeout(() => {
      if (!this._resolved) {
        this.finish(undefined);
      }
    }, 0);
  }
}
