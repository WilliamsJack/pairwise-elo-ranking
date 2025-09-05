import { App, MarkdownView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { MatchResult, UndoFrame } from '../types';

import type EloPlugin from '../../main';
import { pairSig } from '../utils/pair';

export default class ArenaSession {
  private app: App;
  private plugin: EloPlugin;
  private cohortKey: string;
  private files: TFile[];

  private leftFile?: TFile;
  private rightFile?: TFile;
  private lastPairSig?: string;

  private originalLeftViewState?: ViewState;
  private originalLeftLeaf!: WorkspaceLeaf;
  private leftLeaf!: WorkspaceLeaf;
  private rightLeaf!: WorkspaceLeaf;
  private createdRightLeaf = false;

  private undoStack: UndoFrame[] = [];
  private overlayEl?: HTMLElement;
  private keydownHandler = (ev: KeyboardEvent) => this.onKeydown(ev);

  constructor(app: App, plugin: EloPlugin, cohortKey: string, files: TFile[]) {
    this.app = app;
    this.plugin = plugin;
    this.cohortKey = cohortKey;
    this.files = files.slice();
  }

  async start() {
    // Use the most recent leaf as "left"
    this.originalLeftLeaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);
    this.leftLeaf = this.originalLeftLeaf;

    // Create a split for "right"
    const right = this.app.workspace.getLeaf('split');
    if (right && right !== this.leftLeaf) {
      this.rightLeaf = right;
      this.createdRightLeaf = true;
    } else {
      // Fallback: create a right leaf
      this.rightLeaf = this.app.workspace.getRightLeaf(true);
      this.createdRightLeaf = true;
    }

    // Remember original left file to restore later
     const vs = this.leftLeaf.getViewState();
     this.originalLeftViewState = {
       ...vs,
       state: vs.state ? JSON.parse(JSON.stringify(vs.state)) : {},
     };

    this.pickNextPair();
    await this.openCurrent();

    // Pin both leaves during the session
    try { this.leftLeaf.setPinned(true); } catch {}
    try { this.rightLeaf.setPinned(true); } catch {}

    this.mountOverlay();
    window.addEventListener('keydown', this.keydownHandler, true);
  }

  async end() {
    window.removeEventListener('keydown', this.keydownHandler, true);
    this.unmountOverlay();

    // Unpin leaves
    try { this.leftLeaf.setPinned(false); } catch {}
    try { this.rightLeaf.setPinned(false); } catch {}

    // Restore the user's original left file view state
    if (this.originalLeftViewState) {
      try {
        await this.leftLeaf.setViewState({
          ...this.originalLeftViewState,
          active: true, // give focus back to the user's original tab
        });
      } catch {}
    }

    // Close the right leaf we created
    if (this.createdRightLeaf) {
      try { this.rightLeaf.detach(); } catch {}
    }

    this.undoStack = [];
  }

  private async openCurrent() {
    if (!this.leftFile || !this.rightFile) return;
    await Promise.all([
      this.openInReadingMode(this.leftLeaf, this.leftFile),
      this.openInReadingMode(this.rightLeaf, this.rightFile),
    ]);
  }

  private async openInReadingMode(leaf: WorkspaceLeaf, file: TFile) {
    // Force Reading Mode and prevent focus grabbing
    await leaf.setViewState({
      type: 'markdown',
      state: { file: file.path, mode: 'preview' },
      active: false,
    });

    // Safety: if somehow still in edit mode, flip to preview
    const v = leaf.view as MarkdownView | undefined;
    if (v && (v.getState()?.mode as string | undefined) !== 'preview') {
      try {
        const vs = leaf.getViewState();
        await leaf.setViewState({
          ...vs,
          state: { ...(vs.state as any), mode: 'preview' },
          active: false,
        });
      } catch {}
    }
  }

  private mountOverlay() {
    const el = document.createElement('div');
    el.className = 'elo-session-bar';

    const leftLabel = document.createElement('div');
    leftLabel.className = 'elo-side left';
    el.append(leftLabel);

    const controls = document.createElement('div');
    controls.className = 'elo-controls';
    controls.append(
      this.makeButton('← Left', () => this.choose('A')),
      this.makeButton('↑ Draw', () => this.choose('D')),
      this.makeButton('→ Right', () => this.choose('B')),
      this.makeButton('Undo ⌫', () => this.undo()),
      this.makeButton('End Esc', () => this.end()),
    );
    el.append(controls);

    const rightLabel = document.createElement('div');
    rightLabel.className = 'elo-side right';
    el.append(rightLabel);

    document.body.append(el);
    this.overlayEl = el;
    this.updateOverlay();
  }

  private unmountOverlay() {
    if (this.overlayEl?.isConnected) this.overlayEl.remove();
    this.overlayEl = undefined;
  }

  private makeButton(text: string, onClick: () => void) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    return btn;
  }

  private updateOverlay() {
    if (!this.overlayEl) return;
    const left = this.overlayEl.querySelector('.elo-side.left') as HTMLElement;
    const right = this.overlayEl.querySelector('.elo-side.right') as HTMLElement;
    left.textContent = this.leftFile?.basename ?? 'Left';
    right.textContent = this.rightFile?.basename ?? 'Right';
  }

  private onKeydown(ev: KeyboardEvent) {
    // Ignore when typing in inputs/editors
    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || target?.closest('.cm-editor')) return;

    if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      this.choose('A');
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      this.choose('B');
    } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.choose('D');
    } else if (ev.key === 'Backspace') {
      ev.preventDefault();
      this.undo();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      this.end();
    }
  }

  private choose(result: MatchResult) {
    if (!this.leftFile || !this.rightFile) return;

    const { winnerPath, undo } = this.plugin.dataStore.applyMatch(
      this.cohortKey,
      this.leftFile.path,
      this.rightFile.path,
      result,
    );
    this.undoStack.push(undo);

    if (this.plugin.settings.showToasts) {
      if (winnerPath) new Notice(`Winner: ${this.basenameOf(winnerPath)}`);
      else new Notice('Draw');
    }
    this.plugin.dataStore.saveStore();

    this.pickNextPair();
    this.openCurrent();
    this.updateOverlay();
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
      this.leftFile = this.rightFile = undefined;
      return;
    }

    let aIdx = Math.floor(Math.random() * this.files.length);
    let bIdx = Math.floor(Math.random() * this.files.length);
    let guard = 0;
    while (aIdx === bIdx && guard++ < 10) {
      bIdx = Math.floor(Math.random() * this.files.length);
    }

    let a = this.files[aIdx];
    let b = this.files[bIdx];

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

    if (Math.random() < 0.5) {
      this.leftFile = a;
      this.rightFile = b;
    } else {
      this.leftFile = b;
      this.rightFile = a;
    }
    this.lastPairSig = pairSig(this.leftFile.path, this.rightFile.path);
  }

  private basenameOf(p: string): string {
    const f = this.files.find((x) => x.path === p);
    return f?.basename ?? p.split('/').pop() ?? p;
  }
}
