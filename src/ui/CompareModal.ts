import { App, Modal, Notice, TFile } from 'obsidian';

import type EloPlugin from '../main';
import { MatchResult } from '../types';
import { UndoFrame } from '../types';
import { pairSig } from '../utils/pair';

export default class CompareModal extends Modal {
  private plugin: EloPlugin;
  private cohortKey: string;
  private files: TFile[];

  private left?: TFile;
  private right?: TFile;
  private lastPairSig?: string;

  private undoStack: UndoFrame[] = [];

  constructor(app: App, plugin: EloPlugin, cohortKey: string, files: TFile[]) {
    super(app);
    this.plugin = plugin;
    this.cohortKey = cohortKey;
    this.files = files.slice();

    // Keyboard controls
    this.scope.register([], 'ArrowLeft', () => this.choose('A'));
    this.scope.register([], 'ArrowRight', () => this.choose('B'));
    this.scope.register([], 'ArrowUp', () => this.choose('D'));
    this.scope.register([], 'ArrowDown', () => this.choose('D'));
    this.scope.register([], 'Backspace', () => this.undo());
    this.scope.register([], 'Escape', () => this.close());
  }

  onOpen(): void {
    this.setTitle('Elo rating session');
    this.pickNextPair();
    this.render();
  }

  onClose(): void {
    this.undoStack = [];
    this.contentEl.empty();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    if (!this.left || !this.right) {
      contentEl.createEl('p', { text: 'Not enough notes to compare.' });
      return;
    }

    const container = contentEl.createEl('div', { cls: 'elo-compare-container' });
    Object.assign(container.style, {
      display: 'grid',
      gridTemplateColumns: '1fr auto 1fr',
      gap: '12px',
      alignItems: 'stretch',
    });

    // Left card
    const leftCard = container.createEl('div', { cls: 'elo-card' });
    this.renderCard(leftCard, this.left, () => this.choose('A'));

    // Middle controls
    const middle = container.createEl('div', { cls: 'elo-middle' });
    Object.assign(middle.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      justifyContent: 'center',
      alignItems: 'center',
      minWidth: '120px',
    });

    this.renderButtonWithHint(middle, 'Draw', '↑ / ↓', () => this.choose('D'));
    this.renderButtonWithHint(middle, 'Undo', 'Backspace', () => this.undo());
    this.renderButtonWithHint(middle, 'End', 'Esc', () => this.close());

    // Right card
    const rightCard = container.createEl('div', { cls: 'elo-card' });
    this.renderCard(rightCard, this.right, () => this.choose('B'));

    // Selection keyboard shortcuts
    const arrowsHint = contentEl.createEl('div', {
      cls: 'elo-arrows-hint',
      text: 'Choose with arrow keys: Left ← / Right →',
    });
    Object.assign(arrowsHint.style, {
      marginTop: '10px',
      textAlign: 'center',
      opacity: '0.7',
      fontSize: '0.9em',
    });
  }

  private renderCard(card: HTMLElement, file: TFile, onChoose: () => void) {
    Object.assign(card.style, {
      border: '1px solid var(--background-modifier-border)',
      borderRadius: '8px',
      padding: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    });

    const title = card.createEl('div', { text: file.basename, cls: 'elo-title' });
    Object.assign(title.style, { fontWeight: '600' });

    const chooseBtn = card.createEl('button', { text: 'Choose' });
    chooseBtn.onclick = onChoose;
  }

  private renderButtonWithHint(parent: HTMLElement, label: string, hint: string, onClick: () => void) {
    const wrap = parent.createEl('div');
    Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' });

    const btn = wrap.createEl('button', { text: label });
    btn.onclick = onClick;

    const hintEl = wrap.createEl('div', { text: hint });
    Object.assign(hintEl.style, { opacity: '0.7', fontSize: '0.85em' });
  }

  private choose(result: MatchResult) {
    if (!this.left || !this.right) return;

    const { winnerPath, undo } = this.plugin.dataStore.applyMatch(
      this.cohortKey,
      this.left.path,
      this.right.path,
      result
    );

    this.undoStack.push(undo);

    if (this.plugin.settings.showToasts && winnerPath) {
      const file = this.files.find((f) => f.path === winnerPath);
      if (file) new Notice(`Winner: ${file.basename}`);
    } else if (this.plugin.settings.showToasts && !winnerPath) {
      new Notice('Draw');
    }

    this.plugin.dataStore.saveStore();

    this.pickNextPair();
    this.render();
  }

  private undo() {
    const frame = this.undoStack.pop();
    if (!frame) {
      new Notice('Nothing to undo.');
      return;
    }
    const ok = this.plugin.dataStore.revert(frame);
    if (ok && this.plugin.settings.showToasts) new Notice('Undid last match.');
    this.plugin.dataStore.saveStore();
  }

  private pickNextPair() {
    if (this.files.length < 2) {
      this.left = this.right = undefined;
      return;
    }

    // Randomly pick two distinct files
    let aIdx = Math.floor(Math.random() * this.files.length);
    let bIdx = Math.floor(Math.random() * this.files.length);
    let guard = 0;

    while (aIdx === bIdx && guard++ < 10) {
      bIdx = Math.floor(Math.random() * this.files.length);
    }

    let a = this.files[aIdx];
    let b = this.files[bIdx];

    // Avoid immediate repeat of the exact pair (ignoring order), if feasible
    const sig = pairSig(a.path, b.path);
    if (this.lastPairSig === sig && this.files.length >= 3) {
      guard = 0;
      while (guard++ < 10) {
        const idx = Math.floor(Math.random() * this.files.length);
        if (idx !== aIdx && pairSig(a.path, this.files[idx].path) !== this.lastPairSig) {
          b = this.files[idx];
          break;
        }
      }
    }

    // Randomise sides
    if (Math.random() < 0.5) {
      [this.left, this.right] = [a, b];
    } else {
      [this.left, this.right] = [b, a];
    }
    this.lastPairSig = pairSig(this.left.path, this.right.path);
  }
}
