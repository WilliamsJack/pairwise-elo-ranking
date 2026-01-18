import { App, Notice, Setting, TFile } from 'obsidian';

import { listBaseFiles, readBaseViews, type BaseViewInfo } from '../domain/bases/BasesDiscovery';
import { BasePromiseFuzzyModal, BasePromiseModal } from './PromiseModal';

type BaseViewChoice = { view: string; label: string };

class BaseFileSelectModal extends BasePromiseFuzzyModal<TFile> {
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

class BaseViewSelectModal extends BasePromiseFuzzyModal<BaseViewChoice> {
  private choices: BaseViewChoice[];

  constructor(app: App, views: BaseViewInfo[]) {
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

export class ResolveMissingBaseModal extends BasePromiseModal<{ basePath: string; view: string } | undefined> {
  private oldBasePath: string;
  private oldView: string;

  private working = false;

  constructor(app: App, opts: { oldBasePath: string; oldView: string }) {
    super(app);
    this.oldBasePath = opts.oldBasePath;
    this.oldView = opts.oldView;
  }

  async openAndGetSelection(): Promise<{ basePath: string; view: string } | undefined> {
    return this.openAndGetValue();
  }

  private setWorking(v: boolean) {
    this.working = v;
    const buttons = this.contentEl.querySelectorAll('button');
    buttons.forEach((b) => (b.disabled = v));
  }

  private getExistingBaseFile(): TFile | undefined {
    const af = this.app.vault.getAbstractFileByPath(this.oldBasePath);
    if (af instanceof TFile && af.extension.toLowerCase() === 'base') return af;
    return undefined;
  }

  private async pickBaseThenView(): Promise<void> {
    const baseFiles = listBaseFiles(this.app);
    if (baseFiles.length === 0) {
      new Notice('No ".base" files found in your vault.');
      return;
    }

    const baseFile = await new BaseFileSelectModal(this.app, baseFiles).openAndGetValue();
    if (!baseFile) return;

    const views = await readBaseViews(this.app, baseFile);
    if (views.length === 0) {
      new Notice(`No views found in '${baseFile.path}'.`);
      return;
    }

    const viewChoice = await new BaseViewSelectModal(this.app, views).openAndGetValue();
    if (!viewChoice) return;

    this.finish({ basePath: baseFile.path, view: viewChoice.view });
  }

  private async pickViewFromExistingBase(baseFile: TFile): Promise<void> {
    const views = await readBaseViews(this.app, baseFile);
    if (views.length === 0) {
      new Notice(`No views found in '${baseFile.path}'.`);
      return;
    }

    const viewChoice = await new BaseViewSelectModal(this.app, views).openAndGetValue();
    if (!viewChoice) return;

    this.finish({ basePath: baseFile.path, view: viewChoice.view });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const baseFile = this.getExistingBaseFile();

    contentEl.createEl('h3', { text: 'Base missing' });

    const p = contentEl.createEl('p');
    if (!baseFile) {
      p.textContent =
        `The base for this cohort was not found: "${this.oldBasePath}". ` +
        'It may have been renamed or moved. Please pick the base and view again.';
    } else {
      p.textContent =
        `The base view for this cohort could not be found.\n\n` +
        `Base: "${baseFile.path}"\n` +
        `View: "${this.oldView}"\n\n` +
        'The view may have been renamed. Please select the view again (or pick a different base).';
    }

    new Setting(contentEl)
      .setName('Current selection')
      .setDesc('This is what was saved in the cohort definition.')
      .addText((t) => {
        t.setValue(`${this.oldBasePath} (${this.oldView})`).setDisabled(true);
      });

    const actions = new Setting(contentEl).setName('Actions');

    if (baseFile) {
      actions.addButton((b) =>
        b
          .setCta()
          .setButtonText('Pick view...')
          .onClick(async () => {
            if (this.working) return;
            this.setWorking(true);
            try {
              await this.pickViewFromExistingBase(baseFile);
            } finally {
              this.setWorking(false);
            }
          }),
      );
    }

    actions.addButton((b) =>
      b
        .setButtonText('Pick base...')
        .setCta()
        .onClick(async () => {
          if (this.working) return;
          this.setWorking(true);
          try {
            await this.pickBaseThenView();
          } finally {
            this.setWorking(false);
          }
        }),
    );

    actions.addButton((b) => b.setButtonText('Cancel').onClick(() => this.finish(undefined)));
  }
}
