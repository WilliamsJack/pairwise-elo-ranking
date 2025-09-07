import { App, FuzzySuggestModal, TFolder } from 'obsidian';

import { allFolderChoices } from '../domain/cohort/CohortResolver';

export class FolderSelectModal extends FuzzySuggestModal<TFolder> {
  private resolver?: (f?: TFolder) => void;
  private resolved = false;
  private folders: TFolder[];

  constructor(app: App) {
    super(app);
    this.folders = allFolderChoices(app);
    this.setPlaceholder('Pick a folder...');
  }

  async openAndGetSelection(): Promise<TFolder | undefined> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(item: TFolder): string {
    return item.path || '/';
  }

  onChooseItem(item: TFolder): void {
    if (this.resolved) return;
    this.resolved = true;
    const r = this.resolver;
    this.resolver = undefined;
    r?.(item);
    this.close();
  }

  onClose(): void {
    setTimeout(() => {
      if (!this.resolved) {
        this.resolved = true;
        const r = this.resolver;
        this.resolver = undefined;
        r?.(undefined);
      }
    }, 0);
  }
}
