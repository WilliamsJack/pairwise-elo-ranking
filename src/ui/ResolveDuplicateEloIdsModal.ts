import type { App, TFile } from 'obsidian';
import { Notice, Setting } from 'obsidian';

import { removeEloIdEverywhere } from '../utils/NoteIds';
import { BasePromiseModal } from './PromiseModal';

function formatCreatedTime(file: TFile): string {
  const ctime = file.stat.ctime;
  if (!ctime || !Number.isFinite(ctime)) return 'Unknown';
  try {
    return new Date(ctime).toLocaleString('en-AU', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ctime).toString();
  }
}

export class ResolveDuplicateEloIdsModal extends BasePromiseModal<boolean> {
  private eloId: string;
  private files: TFile[];

  private working = false;

  constructor(app: App, opts: { eloId: string; files: TFile[] }) {
    super(app);
    this.eloId = opts.eloId;
    this.files = opts.files.slice();
  }

  async openAndGetResult(): Promise<boolean | undefined> {
    return this.openAndGetValue();
  }

  private setWorking(v: boolean): void {
    this.working = v;
    const buttons = this.contentEl.querySelectorAll('button');
    buttons.forEach((b) => {
      b.disabled = v;
    });
  }

  private sortedByCreatedAsc(files: TFile[]): TFile[] {
    return files.slice().sort((a, b) => {
      const ac = a.stat.ctime;
      const bc = b.stat.ctime;
      return ac - bc || a.path.localeCompare(b.path);
    });
  }

  private async keepIdOnFile(keep: TFile): Promise<void> {
    const others = this.files.filter((f) => f.path !== keep.path);

    const workingNotice = new Notice('Fixing duplicate Elo IDs...', 0);
    let removed = 0;

    try {
      for (const f of others) {
        const changed = await removeEloIdEverywhere(this.app, f);
        if (changed) removed += 1;
      }
    } finally {
      workingNotice.hide();
    }

    new Notice(
      `Kept Elo ID on "${keep.basename}". Removed Elo ID from ${removed} other note${
        removed === 1 ? '' : 's'
      }.`,
    );

    this.finish(true);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: 'Duplicate Elo IDs detected' });

    const msg = contentEl.createEl('p');
    msg.textContent = `Two or more notes in this cohort share the same Elo ID. This usually happens when a note is copied.
      Pairwise Elo Ranking uses the ID to track ratings - duplicates will cause notes to share a single rating history.`;

    const hint = contentEl.createEl('p');
    hint.textContent =
      'If you are not sure which note should keep the ID, keep it on the oldest note and remove it from the newest copy.';

    const idRow = new Setting(contentEl).setName('Duplicate Elo ID').setDesc(this.eloId);
    idRow.settingEl.classList.add('elo-static');

    contentEl.createEl('h4', { text: 'Notes using this Elo ID' });

    const listWrap = contentEl.createDiv();

    const sorted = this.sortedByCreatedAsc(this.files);
    const oldestPath = sorted[0].path;

    for (const f of sorted) {
      const row = new Setting(listWrap).setName('');

      const isOldest = oldestPath != null && f.path === oldestPath;

      row.nameEl.empty();
      if (isOldest) {
        row.nameEl.createEl('strong', { text: f.basename });
        row.nameEl.createSpan({ text: ' (oldest)' });
      } else {
        row.nameEl.createSpan({ text: f.basename });
      }

      row.setDesc('');
      row.descEl.empty();
      row.descEl.createDiv({ text: `Created: ${formatCreatedTime(f)}` });
      row.descEl.createDiv({ text: `Path: ${f.path}` });

      row.addButton((b) =>
        b
          .setCta()
          .setButtonText('Keep Elo ID')
          .onClick(async () => {
            if (this.working) return;
            this.setWorking(true);
            try {
              await this.keepIdOnFile(f);
            } finally {
              this.setWorking(false);
            }
          }),
      );
    }

    contentEl.createEl('hr');

    const actions = new Setting(contentEl).setName('Actions');

    actions.addButton((b) =>
      b.setButtonText('Cancel').onClick(() => {
        this.finish(undefined);
      }),
    );
  }
}
