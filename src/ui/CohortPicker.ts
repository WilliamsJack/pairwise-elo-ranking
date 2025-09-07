import { App, ButtonComponent, FuzzySuggestModal, Modal, Notice, Setting, TFolder, TextComponent, ToggleComponent } from 'obsidian';
import { allFolderChoices, createDefinition, labelForDefinition, parseCohortKey } from '../domain/cohort/CohortResolver';

import { CohortDefinition } from '../types';
import { CohortFrontmatterOptionsModal } from './CohortFrontmatterOptionsModal';
import type EloPlugin from '../../main';
import type { FrontmatterPropertiesSettings } from '../settings/settings';

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
    this.setPlaceholder('Choose a cohort or create a new one...');
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

    // Saved definitions
    const defs = this.plugin.dataStore.listCohortDefs();
    for (const def of defs) {
      if (def.key === 'vault:all') continue;
      if (def.key === lastKey) continue;
      items.push({ kind: 'saved', key: def.key, label: labelForDefinition(def), def });
    }

    // Add "Vault: All notes" only if not already present
    if (!items.some(item => item.kind === 'saved' && item.def?.key === 'vault:all')) {
      items.push({ kind: 'action', action: 'vault-all', label: 'Vault: All notes' });
    }

    // Creation actions
    items.push({ kind: 'action', action: 'active-folder', label: 'New: Active folder' });
    items.push({ kind: 'action', action: 'pick-folder', label: 'New: Pick a folder...' });
    items.push({ kind: 'action', action: 'tag-dialog', label: 'New: Tag cohort (any/all)...' });

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

  private complete(def?: CohortDefinition): void {
    this.emit(def);
    this.close();
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
    return await this.runChild(async () => {
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
    });
  }

  private async chooseTagCohort(): Promise<CohortDefinition | undefined> {
    return await this.runChild(() => new TagCohortModal(this.app).openAndGetDefinition());
  }

  private async chooseFrontmatterOverrides(): Promise<Partial<FrontmatterPropertiesSettings> | undefined> {
    return await this.runChild(() =>
      new CohortFrontmatterOptionsModal(this.app, this.plugin, {
        mode: 'create',
      }).openAndGetOverrides()
    );
  }

  private async applyFrontmatterOverrides(def: CohortDefinition | undefined): Promise<CohortDefinition | undefined> {
    if (!def) return undefined;
    if (!this.plugin.settings.askForOverridesOnCohortCreation) return def;

    const overrides = await this.chooseFrontmatterOverrides();
    if (!overrides) return undefined;
    def.frontmatterOverrides = overrides;
    return def;
  }

  private async buildDefinitionForAction(action: Choice['action']): Promise<CohortDefinition | undefined> {
    switch (action) {
      case 'vault-all':
        return createDefinition('vault:all', {}, 'Vault: All notes');
      case 'active-folder': {
        const active = this.app.workspace.getActiveFile();
        const path = active?.parent?.path;
        if (!path) {
          new Notice('No file selected. Please select a file to use its folder.');
          return undefined;
        }
        return await this.chooseFolderCohort(path);
      }
      case 'pick-folder':
        return await this.chooseFolderCohort();
      case 'tag-dialog':
        return await this.chooseTagCohort();
      default:
        return undefined;
    }
  }

  // If a cohort with the same key already exists, use it and notify the user.
  private useExistingIfDuplicate(def: CohortDefinition | undefined): CohortDefinition | undefined {
    if (!def) return undefined;
    const existing = this.plugin.dataStore.getCohortDef(def.key);
    if (existing) {
      const lbl = labelForDefinition(existing);
      new Notice(`Cohort already exists. Using existing cohort: ${lbl}`);
      return existing;
    }
    return def;
  }

  async onChooseItem(item: Choice): Promise<void> {
    if (item.kind === 'saved') {
      const def = item.def ?? parseCohortKey(item.key);
      this.complete(def);
      return;
    }

    const baseDef = await this.buildDefinitionForAction(item.action);

    // If a cohort with this key already exists, use it and skip any overrides prompt
    const deduped = this.useExistingIfDuplicate(baseDef);
    if (!deduped) {
      this.complete(undefined);
      return;
    }
    if (deduped !== baseDef) {
      this.complete(deduped);
      return;
    }

    // It's a new cohort; optionally ask for overrides
    const finalDef = await this.applyFrontmatterOverrides(baseDef);
    this.complete(finalDef);
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

function normaliseTag(tag: string): string {
  const t = (tag ?? '').trim();
  if (!t) return '';
  return t.startsWith('#') ? t : `#${t}`;
}

class TagCohortModal extends Modal {
  private resolver?: (def?: CohortDefinition) => void;
  private resolved = false;

  private mode: 'any' | 'all' = 'any';

  private availableTags: string[] = [];
  private selectedTags: Set<string> = new Set();
  private selectedTagsEl?: HTMLElement;
  private dropdownSelected?: string;
  private createBtn?: ButtonComponent;

  constructor(app: App) {
    super(app);
  }

  async openAndGetDefinition(): Promise<CohortDefinition | undefined> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  private collectVaultTags(): string[] {
    const set = new Set<string>();

    try {
      const inline = this.app.metadataCache.getTags?.();
      if (inline && typeof inline === 'object') {
        for (const k of Object.keys(inline)) {
          if (k) set.add(normaliseTag(k));
        }
      }
    } catch {}

    return Array.from(set).filter(Boolean).sort();
  }

  private renderSelectedTags(): void {
    const el = this.selectedTagsEl;
    if (!el) return;
    el.empty();

    const tags = Array.from(this.selectedTags).sort();
    if (tags.length === 0) {
      const hint = document.createElement('div');
      hint.textContent = 'No tags selected.';
      hint.style.opacity = '0.7';
      el.appendChild(hint);
      return;
    }

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexWrap = 'wrap';
    list.style.gap = '6px';

    for (const tag of tags) {
      const pill = document.createElement('span');
      pill.className = 'tag';
      pill.textContent = tag;

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '×';
      removeBtn.ariaLabel = `Remove ${tag}`;
      removeBtn.style.marginLeft = '6px';
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.selectedTags.delete(tag);
        this.renderSelectedTags();
        this.updateCreateDisabled();
      });

      const wrap = document.createElement('span');
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'center';
      wrap.appendChild(pill);
      wrap.appendChild(removeBtn);

      list.appendChild(wrap);
    }

    el.appendChild(list);
  }

  private updateCreateDisabled(): void {
    if (this.createBtn) this.createBtn.setDisabled(this.selectedTags.size === 0);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    this.availableTags = this.collectVaultTags();

    contentEl.createEl('h3', { text: 'Create tag cohort' });

    const hasAvailable = this.availableTags.length > 0;
    new Setting(contentEl)
      .setName('Select tags')
      .setDesc(hasAvailable ? 'Pick a tag and click Add. Repeat to add multiple.' : 'No tags found in your vault.')
      .addDropdown((dd) => {
        const options: Record<string, string> = {};
        for (const t of this.availableTags) options[t] = t;
        dd.addOptions(options).setDisabled(!hasAvailable).onChange((v) => {
          this.dropdownSelected = v;
        });
        if (hasAvailable) {
          this.dropdownSelected = this.availableTags[0];
          dd.setValue(this.dropdownSelected);
        }
      })
      .addButton((b) =>
        b
          .setButtonText('Add')
          .setDisabled(!hasAvailable)
          .onClick(() => {
            const tag = normaliseTag(this.dropdownSelected ?? '');
            if (!tag) return;
            this.selectedTags.add(tag);
            this.renderSelectedTags();
            this.updateCreateDisabled();
          }),
      )
      .addButton((b) =>
        b
          .setButtonText('Clear')
          .onClick(() => {
            this.selectedTags.clear();
            this.renderSelectedTags();
            this.updateCreateDisabled();
          }),
      );

    const sel = new Setting(contentEl).setName('Selected tags');
    this.selectedTagsEl = sel.controlEl.createDiv();
    this.renderSelectedTags();

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
    btns.addButton((b) => {
      this.createBtn = b.setCta().setButtonText('Create').onClick(() => {
        if (this.selectedTags.size === 0) return; // require at least one tag
        const tags = Array.from(this.selectedTags).sort();
        const kind = this.mode === 'all' ? 'tag:all' : 'tag:any';
        const def = createDefinition(kind, { tags });
        if (this.resolved) return;
        this.resolved = true;
        const r = this.resolver;
        this.resolver = undefined;
        r?.(def);
        this.close();
      });
      this.updateCreateDisabled();
      return this.createBtn;
    });
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
