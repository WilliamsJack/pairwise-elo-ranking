import { App, ButtonComponent, FuzzySuggestModal, Notice, Setting } from 'obsidian';
import { BasePromiseFuzzyModal, BasePromiseModal } from './PromiseModal';
import { createDefinition, parseCohortKey, prettyCohortDefinition } from '../domain/cohort/CohortResolver';

import { CohortDefinition } from '../types';
import { CohortOptionsModal } from './CohortOptionsModal';
import type EloPlugin from '../../main';
import { FolderSelectModal } from './FolderPicker';
import type { FrontmatterPropertiesSettings } from '../settings';
import { normaliseTag } from '../utils/tags';

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
      if (lastDef) items.push({ kind: 'saved', key: lastDef.key, label: `Last used: ${lastDef.label ?? prettyCohortDefinition(lastDef)}`, def: lastDef });
    }

    // Saved definitions
    const defs = this.plugin.dataStore.listCohortDefs();
    for (const def of defs) {
      if (def.key === 'vault:all') continue;
      if (def.key === lastKey) continue;
      items.push({ kind: 'saved', key: def.key, label: def.label ?? prettyCohortDefinition(def), def });
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

  private async chooseFrontmatterOverrides(): Promise<{ overrides?: Partial<FrontmatterPropertiesSettings>; name?: string } | undefined> {
    return await this.runChild(() =>
      new CohortOptionsModal(this.app, this.plugin, {
        mode: 'create',
      }).openAndGetOptions(),
    );
  }

  private async applyFrontmatterOverrides(def: CohortDefinition | undefined): Promise<CohortDefinition | undefined> {
    if (!def) return undefined;
    if (!this.plugin.settings.askForOverridesOnCohortCreation) return def;

    const res = await this.chooseFrontmatterOverrides();
    if (!res) return undefined;

    const overrides = res.overrides ?? {};
    const hasKeys = Object.keys(overrides).length > 0;
    def.frontmatterOverrides = hasKeys ? overrides : undefined;

    const newName = (res.name ?? '').trim();
    if (newName.length > 0) def.label = newName;

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
      const lbl = existing.label ?? prettyCohortDefinition(existing);
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

class FolderScopeModal extends BasePromiseModal<'folder' | 'folder-recursive' | undefined> {
  private selected: 'folder' | 'folder-recursive' = 'folder';
  private folderPath: string;

  constructor(app: App, folderPath: string) {
    super(app);
    this.folderPath = folderPath;
  }

  async openAndGetScope(): Promise<'folder' | 'folder-recursive' | undefined> {
    return this.openAndGetValue();
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
        this.finish(undefined);
      }),
    );
    btns.addButton((b) =>
      b.setCta().setButtonText('Select').onClick(() => {
        this.finish(this.selected);
      }),
    );
  }
}

// Reusable fuzzy tag picker that returns a single tag
class TagSelectFuzzyModal extends BasePromiseFuzzyModal<string> {
  private tags: string[];

  constructor(app: App, tags: string[]) {
    super(app);
    this.tags = tags;
    this.setPlaceholder('Search tags...');
  }

  getItems(): string[] {
    return this.tags;
  }

  getItemText(item: string): string {
    return item;
  }
}

class TagCohortModal extends BasePromiseModal<CohortDefinition | undefined> {
  private mode: 'any' | 'all' = 'any';

  private availableTags: string[] = [];
  private selectedTags: Set<string> = new Set();
  private selectedTagsEl?: HTMLElement;
  private createBtn?: ButtonComponent;
  private addBtn?: ButtonComponent;

  constructor(app: App) {
    super(app);
  }

  async openAndGetDefinition(): Promise<CohortDefinition | undefined> {
    return this.openAndGetValue();
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
      el.createDiv({ cls: 'elo-muted', text: 'No tags selected.' });
      return;
    }

    const list = el.createDiv({ cls: 'elo-selected-tags' });

    for (const tag of tags) {
      const wrap = list.createSpan({ cls: 'elo-tag-wrap' });

      wrap.createSpan({ cls: 'tag', text: tag });

      const removeBtn = wrap.createEl('button', { cls: 'elo-tag-remove', text: '×' });
      removeBtn.ariaLabel = `Remove ${tag}`;
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.selectedTags.delete(tag);
        this.renderSelectedTags();
        this.updateButtonsDisabled();
      });
    }
  }

  private updateButtonsDisabled(): void {
    const remaining = this.availableTags.filter((t) => !this.selectedTags.has(t));
    if (this.addBtn) this.addBtn.setDisabled(remaining.length === 0);
    if (this.createBtn) this.createBtn.setDisabled(this.selectedTags.size === 0);
  }

  private async addTagViaFuzzy(): Promise<void> {
    const remaining = this.availableTags.filter((t) => !this.selectedTags.has(t));
    if (remaining.length === 0) return;
    const picked = await new TagSelectFuzzyModal(this.app, remaining).openAndGetValue();
    const tag = normaliseTag(picked ?? '');
    if (!tag) return;
    this.selectedTags.add(tag);
    this.renderSelectedTags();
    this.updateButtonsDisabled();
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    this.availableTags = this.collectVaultTags();

    contentEl.createEl('h3', { text: 'Create tag cohort' });

    // Add/clear actions with fuzzy tag selection
    const hasAvailable = this.availableTags.length > 0;
    new Setting(contentEl)
      .setName('Select tags')
      .setDesc(hasAvailable ? 'Click "Add tag..." and search to add multiple tags.' : 'No tags found in your vault.')
      .addButton((b) => {
        this.addBtn = b
          .setButtonText('Add tag...')
          .setDisabled(!hasAvailable)
          .onClick(async () => {
            await this.addTagViaFuzzy();
          });
        return this.addBtn;
      })
      .addButton((b) =>
        b
          .setButtonText('Clear')
          .onClick(() => {
            this.selectedTags.clear();
            this.renderSelectedTags();
            this.updateButtonsDisabled();
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
        this.finish(undefined);
      }),
    );
    btns.addButton((b) => {
      this.createBtn = b.setCta().setButtonText('Create').onClick(() => {
        if (this.selectedTags.size === 0) return;
        const tags = Array.from(this.selectedTags).sort();
        const kind = this.mode === 'all' ? 'tag:all' : 'tag:any';
        const def = createDefinition(kind, { tags });
        this.finish(def);
      });
      this.updateButtonsDisabled();
      return this.createBtn;
    });
  }
}
