import { App, Modal, Setting } from 'obsidian';

import { FolderSelectModal } from './FolderPicker';
import { getEloId } from '../utils/NoteIds';

type Suggestion = {
  path: string;
  count: number;
};

export class ResolveMissingFolderModal extends Modal {
  private oldPath: string;
  private recursive: boolean;
  private cohortIds: Set<string>;

  private resolver?: (path?: string) => void;
  private resolved = false;

  private listEl?: HTMLElement;
  private progressEl?: HTMLElement;

  private suggestions = new Map<string, number>();
  private progress = { done: 0, total: 0 };
  private scanning = false;
  private cancelled = false;
  private lastRenderTs = 0;

  constructor(app: App, opts: { oldPath: string; recursive: boolean; cohortIds: Set<string> }) {
    super(app);
    this.oldPath = opts.oldPath;
    this.recursive = opts.recursive;
    this.cohortIds = opts.cohortIds;
  }

  async openAndGetFolderPath(): Promise<string | undefined> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: 'Folder missing' });
    const p = contentEl.createEl('p');
    p.textContent = `The folder for this cohort was not found: "${this.oldPath}". Pick the current location for this cohort.`;

    const info = contentEl.createEl('p');
    info.textContent = 'Suggestions are based on notes in this cohort that still exist in your vault.';

    const prog = new Setting(contentEl).setName('Scan progress');
    this.progressEl = prog.controlEl.createDiv();
    this.progressEl.textContent = '0/0';

    const suggested = new Setting(contentEl).setName('Suggested folders');
    this.listEl = suggested.controlEl.createDiv();

    new Setting(contentEl)
      .setName('Actions')
      .addButton((b) =>
        b.setButtonText('Browse...').onClick(async () => {
          const folder = await new FolderSelectModal(this.app).openAndGetSelection();
          if (!folder) return;
          this.finish(folder.path);
        }),
      )
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.finish(undefined)));

    this.startScan().catch(() => {});
  }

  private renderProgress(): void {
    if (!this.progressEl) return;
    const { done, total } = this.progress;
    this.progressEl.textContent = this.scanning ? `${done}/${total}` : `Done ${done}/${total}`;
  }

  private maybeRenderList(): void {
    const now = Date.now();
    if (now - this.lastRenderTs < 150) {
      this.renderProgress();
      return;
    }
    this.lastRenderTs = now;
    this.renderProgress();
    this.renderList();
  }

  private renderList(): void {
    if (!this.listEl) return;
    const el = this.listEl;
    el.empty();

    const items: Suggestion[] = Array.from(this.suggestions.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));

    if (items.length === 0) {
      const hint = document.createElement('div');
      hint.textContent = this.scanning
        ? 'Building suggestions...'
        : 'No suggestions. Use Browse to pick a folder.';
      hint.style.opacity = '0.7';
      el.appendChild(hint);
      return;
    }

    for (const s of items.slice(0, 10)) {
      const row = new Setting(el)
        .setName(s.path || '/')
        .setDesc(`${s.count} note${s.count === 1 ? '' : 's'} with matching Elo IDs`)
        .addButton((b) => b.setCta().setButtonText('Use').onClick(() => this.finish(s.path)));
      row.settingEl.style.cursor = 'default';
    }
  }

  private async startScan(): Promise<void> {
    if (this.cohortIds.size === 0) {
      this.scanning = false;
      this.renderProgress();
      this.renderList();
      return;
    }

    const files = this.app.vault.getMarkdownFiles();
    this.progress.total = files.length;
    this.scanning = true;
    this.renderProgress();

    const pool = 8;
    let idx = 0;

    const worker = async () => {
      while (!this.cancelled) {
        const i = idx++;
        if (i >= files.length) break;
        const f = files[i];

        try {
          const id = await getEloId(this.app, f);
          if (id && this.cohortIds.has(id)) {
            const folder = f.parent?.path ?? '';
            this.suggestions.set(folder, (this.suggestions.get(folder) ?? 0) + 1);
          }
        } catch {
          // ignore
        } finally {
          this.progress.done += 1;
          this.maybeRenderList();
        }
      }
    };

    await Promise.all(Array.from({ length: pool }, () => worker()));

    this.scanning = false;
    this.renderProgress();
    this.renderList();
  }

  private finish(path?: string) {
    if (this.resolved) return;
    this.cancelled = true;
    this.resolved = true;
    const r = this.resolver;
    this.resolver = undefined;
    r?.(path);
    this.close();
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
