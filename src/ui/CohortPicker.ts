import { App, FuzzySuggestModal, Modal, Setting, TFolder, TextComponent, ToggleComponent } from 'obsidian';
import { allFolderChoices, createDefinition, labelForDefinition, parseCohortKey } from '../domain/cohort/CohortResolver';

import { CohortDefinition } from '../types';
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

  private async chooseFrontmatterOverrides(): Promise<FrontmatterPropertiesSettings | undefined> {
    return await this.runChild(() =>
      new CohortFrontmatterOptionsModal(this.app, this.plugin).openAndGetOverrides()
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
        if (!path) return createDefinition('vault:all', {}, 'Vault: All notes');
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

  async onChooseItem(item: Choice): Promise<void> {
    if (item.kind === 'saved') {
      const def = item.def ?? parseCohortKey(item.key);
      this.complete(def);
      return;
    }

    const baseDef = await this.buildDefinitionForAction(item.action);
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

class CohortFrontmatterOptionsModal extends Modal {
  private plugin: EloPlugin;
  private resolver?: (overrides?: FrontmatterPropertiesSettings) => void;
  private resolved = false;

  private working: FrontmatterPropertiesSettings;

  constructor(app: App, plugin: EloPlugin) {
    super(app);
    this.plugin = plugin;
    const d = plugin.settings.frontmatterProperties;
    this.working = {
      rating: { property: d.rating.property, enabled: d.rating.enabled },
      rank: { property: d.rank.property, enabled: d.rank.enabled },
      matches: { property: d.matches.property, enabled: d.matches.enabled },
      wins: { property: d.wins.property, enabled: d.wins.enabled },
    };
  }

  async openAndGetOverrides(): Promise<FrontmatterPropertiesSettings | undefined> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: 'Cohort options' });
    contentEl.createEl('p', {
      text:
        'Configure which Elo statistics to write into frontmatter for this cohort and the property names to use. ' +
        'These defaults are prefilled from the plugin settings.',
    });

    const defaults = this.plugin.settings.frontmatterProperties;

    const addRow = (
      key: keyof FrontmatterPropertiesSettings,
      label: string,
      desc: string,
      placeholder: string,
    ) => {
      const cfg = this.working[key];
      let textRef: TextComponent;

      new Setting(contentEl)
        .setName(label)
        .setDesc(desc)
        .addToggle((t: ToggleComponent) =>
          t
            .setValue(Boolean(cfg.enabled))
            .onChange((val) => {
              cfg.enabled = val;
              if (textRef) textRef.setDisabled(!val);
            }),
        )
        .addText((t) => {
          textRef = t;
          t.setPlaceholder(placeholder)
            .setValue(cfg.property)
            .setDisabled(!cfg.enabled)
            .onChange((v) => {
              const trimmed = (v ?? '').trim();
              cfg.property = trimmed.length > 0 ? trimmed : placeholder;
            });
        });
    };

    addRow('rating', 'Rating', 'Write the current Elo rating to this property.', defaults.rating.property || 'eloRating');
    addRow('rank', 'Rank', 'Write the cohort rank (1 = highest) to this property.', defaults.rank.property || 'eloRank');
    addRow('matches', 'Matches', 'Write the number of matches to this property.', defaults.matches.property || 'eloMatches');
    addRow('wins', 'Wins', 'Write the number of wins to this property.', defaults.wins.property || 'eloWins');

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
      b.setCta().setButtonText('Create cohort').onClick(() => {
        if (this.resolved) return;
        this.resolved = true;
        const r = this.resolver;
        this.resolver = undefined;
        r?.(this.working);
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
