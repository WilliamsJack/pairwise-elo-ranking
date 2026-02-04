import type { App, TFile } from 'obsidian';

import { BasePromiseFuzzyModal } from './PromiseModal';

export type BaseViewChoice = { view: string; label: string };
export type BaseViewLike = { name: string; type?: string };

export class BaseFileSelectModal extends BasePromiseFuzzyModal<TFile> {
  private files: TFile[];

  constructor(app: App, files: TFile[]) {
    super(app);
    this.files = files.slice().sort((a, b) => a.path.localeCompare(b.path));
    this.setPlaceholder('Pick a ".base" file...');
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(item: TFile): string {
    return item.path;
  }
}

export class BaseViewSelectModal extends BasePromiseFuzzyModal<BaseViewChoice> {
  private choices: BaseViewChoice[];

  constructor(app: App, views: BaseViewLike[]) {
    super(app);

    this.choices = views
      .map((v) => ({
        view: v.name,
        label: v.type ? `${v.name} (${v.type})` : v.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    this.setPlaceholder('Pick a view...');
  }

  getItems(): BaseViewChoice[] {
    return this.choices;
  }

  getItemText(item: BaseViewChoice): string {
    return item.label;
  }
}
