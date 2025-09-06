import { App, FuzzySuggestModal, Modal, Setting, TFolder } from 'obsidian';
import { allFolderChoices, createDefinition, labelForDefinition, parseCohortKey } from '../domain/cohort/CohortResolver';

import { CohortDefinition } from '../types';
import type EloPlugin from '../../main';

type Choice =
  | { kind: 'saved'; key: string; label: string; def?: CohortDefinition }
  | { kind: 'action'; action: 'vault-all' | 'active-folder' | 'pick-folder' | 'tag-dialog'; label: string };

export class CohortPicker extends FuzzySuggestModal<Choice> {
  private plugin: EloPlugin;
  private resolver?: (def?: CohortDefinition) => void;
  private resolved = false;
  private awaitingChild = false;

  constructor(app: App, plugin: EloPlugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder('Choose a cohort or create a new one…');
  }

  async openAndGetSelection(): Promise<CohortDefinition | undefined> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  getItems(): Choice[] {
    const items: Choice[] = [];

    // Last used
    const lastKey = this.plugin.dataStore.store.lastUsedCohortKey;
    if (lastKey) {
      const lastDef = this.plugin.dataStore.getCohortDef(lastKey) ?? parseCohortKey(lastKey);
      if (lastDef) items.push({ kind: 'saved', key: lastDef.key, label: `Last used: ${labelForDefinition(lastDef)}`, def: lastDef });
    }

    // Existing cohorts with Elo data
    const existingKeys = Object.keys(this.plugin.dataStore.store.cohorts ?? {});
    for (const key of existingKeys) {
      const def = this.plugin.dataStore.getCohortDef(key) ?? parseCohortKey(key);
      if (def) items.push({ kind: 'saved', key, label: labelForDefinition(def), def });
      else items.push({ kind: 'saved', key, label: key });
    }

    // Saved definitions (no data yet)
    const defs = this.plugin.dataStore.listCohortDefs();
    for (const def of defs) {
      if (!existingKeys.includes(def.key) && def.key !== lastKey) {
        items.push({ kind: 'saved', key: def.key, label: labelForDefinition(def), def });
      }
    }

    // Creation actions
    items.push({ kind: 'action', action: 'vault-all', label: 'New: Whole vault' });
    items.push({ kind: 'action', action: 'active-folder', label: 'New: Active folder' });
    items.push({ kind: 'action', action: 'pick-folder', label: 'New: Pick a folder…' });
    items.push({ kind: 'action', action: 'tag-dialog', label: 'New: Tag cohort (any/all)…' });

    return items;
  }

  getItemText(item: Choice): string {
    return item.label;
  }

  private emit(def?: CohortDefinition): void {
    if (this.resolved) return;
    this.resolved = true;
    const r = this.resolver;
    this.resolver = undefined;
    r?.(def);
  }

  // Wraps any child modal flow and manages the awaitingChild flag
  private async runChild<T>(fn: () => Promise<T>): Promise<T> {
    this.awaitingChild = true;
    try {
      return await fn();
    } finally {
      this.awaitingChild = false;
    }
  }

  // Handles folder selection (optional) + scope, and returns a ready CohortDefinition
  private async chooseFolderCohort(initialPath?: string): Promise<CohortDefinition | undefined> {
    let path = initialPath;

    if (!path) {
      const folder = await new FolderSelectModal(this.app).openAndGetSelection();
      if (!folder) return undefined;
      path = folder.path;
    }

    const scope = await new FolderScopeModal(this.app, path).openAndGetScope();
    if (!scope) return undefined;

    const kind = scope === 'folder-recursive' ? 'folder-recursive' : 'folder';
    return createDefinition(kind, { path });
  }

  async onChooseItem(item: Choice): Promise<void> {
    if (item.kind === 'saved') {
      const def = item.def ?? parseCohortKey(item.key);
      this.emit(def);
      this.close();
      return;
    }

    if (item.action === 'vault-all') {
      const def = createDefinition('vault:all', {}, 'Vault: All notes');
      this.emit(def);
      this.close();
      return;
    }

    if (item.action === 'active-folder') {
      const active = this.app.workspace.getActiveFile();
      const path = active?.parent?.path;
      if (!path) {
        const def = createDefinition('vault:all', {}, 'Vault: All notes');
        this.emit(def);
        this.close();
        return;
      }
      const def = await this.runChild(() => this.chooseFolderCohort(path));
      this.emit(def ?? undefined);
      this.close();
      return;
    }

    if (item.action === 'pick-folder') {
      const def = await this.runChild(() => this.chooseFolderCohort());
      this.emit(def ?? undefined);
      this.close();
      return;
    }

    if (item.action === 'tag-dialog') {
      const res = await this.runChild(() => new TagCohortModal(this.app).openAndGetDefinition());
      this.emit(res ?? undefined);
      this.close();
      return;
    }
  }

  onClose(): void {
    setTimeout(() => {
      if (!this.resolved && !this.awaitingChild) {
        this.emit(undefined);
      }
    }, 0);
  }
}

class FolderSelectModal extends FuzzySuggestModal<TFolder> {
  private resolver?: (f?: TFolder) => void;
  private resolved = false;
  private folders: TFolder[];

  constructor(app: App) {
    super(app);
    this.folders = allFolderChoices(app);
    this.setPlaceholder('Pick a folder…');
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

class FolderScopeModal extends Modal {
  private resolver?: (kind?: 'folder' | 'folder-recursive') => void;
  private resolved = false;

  private selected: 'folder' | 'folder-recursive' = 'folder';
  private folderPath: string;

  constructor(app: App, folderPath: string) {
    super(app);
    this.folderPath = folderPath;
  }

  async openAndGetScope(): Promise<'folder' | 'folder-recursive' | undefined> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: 'Folder scope' });
    contentEl.createEl('p', { text: `Folder: ${this.folderPath}` });

    new Setting(contentEl)
      .setName('Scope')
      .setDesc('Choose whether to include subfolders.')
      .addDropdown((dd) => {
        dd.addOptions({
          folder: 'Only this folder',
          'folder-recursive': 'This folder and all subfolders',
        })
          .setValue(this.selected)
          .onChange((v) => {
            this.selected = v === 'folder-recursive' ? 'folder-recursive' : 'folder';
          });
      });

    const btns = new Setting(contentEl);
    btns.addButton((b) =>
      b.setButtonText('Cancel').onClick(() => {
        if (this.resolved) return;
        this.resolved = true;
        const r = this.resolver;
        this.resolver = undefined;
        r?.(undefined);
        this.close();
      }),
    );
    btns.addButton((b) =>
      b.setCta().setButtonText('Select').onClick(() => {
        if (this.resolved) return;
        this.resolved = true;
        const r = this.resolver;
        this.resolver = undefined;
        r?.(this.selected);
        this.close();
      }),
    );
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      const r = this.resolver;
      this.resolver = undefined;
      r?.(undefined);
    }
  }
}

class TagCohortModal extends Modal {
  private resolver?: (def?: CohortDefinition) => void;
  private resolved = false;

  private tagsInputValue = '';
  private mode: 'any' | 'all' = 'any';

  constructor(app: App) {
    super(app);
  }

  async openAndGetDefinition(): Promise<CohortDefinition | undefined> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: 'Create tag cohort' });

    new Setting(contentEl)
      .setName('Tags')
      .setDesc('Comma-separated tags (with or without leading #).')
      .addText((t) => {
        t.setPlaceholder('#recipes, #dinner').onChange((v) => (this.tagsInputValue = v ?? ''));
      });

    new Setting(contentEl)
      .setName('Match mode')
      .setDesc('Choose how notes match the tags.')
      .addDropdown((dd) => {
        dd.addOptions({ any: 'Any of (OR)', all: 'All of (AND)' })
          .setValue(this.mode)
          .onChange((v) => (this.mode = v === 'all' ? 'all' : 'any'));
      });

    const btns = new Setting(contentEl);
    btns.addButton((b) =>
      b.setButtonText('Cancel').onClick(() => {
        if (this.resolved) return;
        this.resolved = true;
        const r = this.resolver;
        this.resolver = undefined;
        r?.(undefined);
        this.close();
      }),
    );
    btns.addButton((b) =>
      b.setCta().setButtonText('Create').onClick(() => {
        const raw = this.tagsInputValue ?? '';
        const tags = raw.split(',').map((s) => s.trim()).filter(Boolean);
        const kind = this.mode === 'all' ? 'tag:all' : 'tag:any';
        const def = createDefinition(kind, { tags });
        if (this.resolved) return;
        this.resolved = true;
        const r = this.resolver;
        this.resolver = undefined;
        r?.(def);
        this.close();
      }),
    );
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      const r = this.resolver;
      this.resolver = undefined;
      r?.(undefined);
    }
  }
}
