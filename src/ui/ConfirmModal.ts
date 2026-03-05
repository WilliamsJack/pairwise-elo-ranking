import type { App } from 'obsidian';
import { Setting } from 'obsidian';

import { BasePromiseModal } from './PromiseModal';

export class ConfirmModal extends BasePromiseModal<boolean> {
  private titleText: string;
  private message: string;
  private ctaText: string;
  private cancelText: string;
  private warningCta: boolean;

  constructor(
    app: App,
    titleText: string,
    message: string,
    ctaText: string,
    cancelText?: string,
    warningCta = false,
  ) {
    super(app);
    this.titleText = titleText;
    this.message = message;
    this.ctaText = ctaText;
    this.cancelText = cancelText ? cancelText : 'Cancel';
    this.warningCta = warningCta;
  }

  async openAndConfirm(): Promise<boolean> {
    const v = await this.openAndGetValue();
    return !!v;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: this.titleText });
    const p = contentEl.createEl('p');
    p.textContent = this.message;

    const btns = new Setting(contentEl);
    btns.addButton((b) => b.setButtonText(this.cancelText).onClick(() => this.finish(false)));
    btns.addButton((b) => {
      if (this.warningCta) b.setWarning();
      else b.setCta();
      b.setButtonText(this.ctaText).onClick(() => this.finish(true));
    });
  }
}
