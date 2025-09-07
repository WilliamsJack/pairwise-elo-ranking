import { App, TFolder } from 'obsidian';

import { BasePromiseFuzzyModal } from './PromiseModal';
import { allFolderChoices } from '../domain/cohort/CohortResolver';

export class FolderSelectModal extends BasePromiseFuzzyModal<TFolder> {
  private folders: TFolder[];

  constructor(app: App) {
    super(app);
    this.folders = allFolderChoices(app);
    this.setPlaceholder('Pick a folder...');
  }

  async openAndGetSelection(): Promise<TFolder | undefined> {
    return this.openAndGetValue();
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(item: TFolder): string {
    return item.path || '/';
  }
}
