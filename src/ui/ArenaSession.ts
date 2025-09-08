import { App, MarkdownView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { ArenaLayoutHandle, ArenaLayoutManager } from './LayoutManager';
import { MatchResult, UndoFrame } from '../types';
import { ensureEloId, getEloId } from '../utils/NoteIds';

import type EloPlugin from '../../main';
import type { FrontmatterPropertiesSettings } from '../settings';
import { effectiveFrontmatterProperties } from '../settings';
import { pairSig } from '../utils/pair';
import { writeFrontmatterStatsForPair } from '../utils/FrontmatterStats';

export default class ArenaSession {
  private app: App;
  private plugin: EloPlugin;
  private cohortKey: string;
  private files: TFile[];

  private leftFile?: TFile;
  private rightFile?: TFile;
  private lastPairSig?: string;

  private leftLeaf!: WorkspaceLeaf;
  private rightLeaf!: WorkspaceLeaf;

  private idByPath = new Map<string, string>();

  private undoStack: UndoFrame[] = [];
  private overlayEl?: HTMLElement;
  private overlayDoc?: Document;
  private overlayWin?: Window;
  private popoutUnloadHandler?: () => void;
  private keydownHandler = (ev: KeyboardEvent) => this.onKeydown(ev);

  private layoutHandle?: ArenaLayoutHandle;

  constructor(app: App, plugin: EloPlugin, cohortKey: string, files: TFile[]) {
    this.app = app;
    this.plugin = plugin;
    this.cohortKey = cohortKey;
    this.files = files.slice();
  }

  async start() {
    // Create arena layout per settings
    const mgr = new ArenaLayoutManager(this.app);
    this.layoutHandle = await mgr.create(this.plugin.settings.sessionLayout ?? 'right-split');

    this.leftLeaf = this.layoutHandle.leftLeaf;
    this.rightLeaf = this.layoutHandle.rightLeaf;

    this.pickNextPair();
    await this.openCurrent();

    // Resolve the correct document/window for UI and keyboard capture.
    // Prefer the left leaf's view container; fall back to manager's doc/win.
    const doc =
      (this.leftLeaf.view as any)?.containerEl?.ownerDocument ??
      (this.rightLeaf.view as any)?.containerEl?.ownerDocument ??
      this.layoutHandle.doc ??
      document;
    const win = doc.defaultView ?? this.layoutHandle.win ?? window;

    this.overlayDoc = doc;
    this.overlayWin = win;

    // Pin both leaves during the session
    try { this.leftLeaf.setPinned(true); } catch {}
    try { this.rightLeaf.setPinned(true); } catch {}

    this.mountOverlay(doc);
    win.addEventListener('keydown', this.keydownHandler, true);

    // If the user closes a pop-out window, end the session automatically.
    if (win !== window) {
      this.popoutUnloadHandler = () => this.plugin.endSession();
      win.addEventListener('beforeunload', this.popoutUnloadHandler);
    }
  }

  async end() {
    // Remove listeners from the correct window
    if (this.overlayWin) {
      try { this.overlayWin.removeEventListener('keydown', this.keydownHandler, true); } catch {}
      if (this.popoutUnloadHandler) {
        try { this.overlayWin.removeEventListener('beforeunload', this.popoutUnloadHandler); } catch {}
      }
    }
    this.popoutUnloadHandler = undefined;

    this.unmountOverlay();

    // Unpin leaves
    try { this.leftLeaf.setPinned(false); } catch {}
    try { this.rightLeaf.setPinned(false); } catch {}

    // Delegate tidy-up to the layout manager
    try { await this.layoutHandle?.cleanup(); } catch {}

    this.overlayDoc = undefined;
    this.overlayWin = undefined;
    this.undoStack = [];
  }

  public getCohortKey(): string {
    return this.cohortKey;
  }

  onFileRenamed(oldPath: string, newFile: TFile) {
    // Update our id map to the new path
    const id = this.idByPath.get(oldPath);
    if (id) {
      this.idByPath.delete(oldPath);
      this.idByPath.set(newFile.path, id);
    }
    // Update labels if visible
    if (this.leftFile?.path === oldPath) this.leftFile = newFile;
    if (this.rightFile?.path === oldPath) this.rightFile = newFile;
    this.lastPairSig = this.leftFile && this.rightFile
      ? pairSig(this.leftFile.path, this.rightFile.path)
      : undefined;
    this.updateOverlay();
  }

  private async openCurrent() {
    if (!this.leftFile || !this.rightFile) return;

    // Lazily ensure eloIds only for the notes being displayed
    await Promise.all([
      this.getIdForFile(this.leftFile),
      this.getIdForFile(this.rightFile),
    ]);

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

  private mountOverlay(doc: Document = document) {
    const el = doc.body.createDiv({ cls: 'elo-session-bar' });

    el.createDiv({ cls: 'elo-side left' });

    const controls = el.createDiv({ cls: 'elo-controls' });
    controls.append(
      this.makeButton('← Left', () => this.choose('A')),
      this.makeButton('↑ Draw', () => this.choose('D')),
      this.makeButton('→ Right', () => this.choose('B')),
      this.makeButton('Undo ⌫', () => this.undo()),
      this.makeButton('End Esc', () => this.plugin.endSession()),
    );

    el.createDiv({ cls: 'elo-side right' });

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
      this.plugin.endSession();
    }
  }

  private getEffectiveFrontmatter(): FrontmatterPropertiesSettings {
    const def = this.plugin.dataStore.getCohortDef(this.cohortKey);
    return effectiveFrontmatterProperties(
      this.plugin.settings.frontmatterProperties,
      def?.frontmatterOverrides,
    );
  }

  private async choose(result: MatchResult) {
    if (!this.leftFile || !this.rightFile) return;

    const [aId, bId] = await Promise.all([
      this.getIdForFile(this.leftFile),
      this.getIdForFile(this.rightFile),
    ]);

    const { undo } = this.plugin.dataStore.applyMatch(
      this.cohortKey,
      aId,
      bId,
      result,
    );
    this.undoStack.push(undo);

    if (this.plugin.settings.showToasts) {
      if (result === 'A') new Notice(`Winner: ${this.leftFile.basename}`);
      else if (result === 'B') new Notice(`Winner: ${this.rightFile.basename}`);
      else new Notice('Draw');
    }
    this.plugin.dataStore.saveStore();

    // Write frontmatter stats to both notes
    const cohort = this.plugin.dataStore.store.cohorts[this.cohortKey];
    const fm = this.getEffectiveFrontmatter();
    void writeFrontmatterStatsForPair(
      this.app,
      fm,
      cohort,
      this.leftFile,
      aId,
      this.rightFile,
      bId,
    );

    this.pickNextPair();
    this.openCurrent();
    this.updateOverlay();
  }

  private async getIdForFile(file: TFile): Promise<string> {
    const cached = this.idByPath.get(file.path);
    if (cached) return cached;

    const existing = await getEloId(this.app, file);
    if (existing) {
      this.idByPath.set(file.path, existing);
      return existing;
    }
    const id = await ensureEloId(this.app, file, this.plugin.settings.eloIdLocation ?? 'frontmatter');
    this.idByPath.set(file.path, id);
    return id;
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

    // Update the two notes involved in the undone match, if we can find them
    const aFile = this.findFileById(frame.a.id);
    const bFile = this.findFileById(frame.b.id);
    const cohort = this.plugin.dataStore.store.cohorts[frame.cohortKey];
    const fm = this.getEffectiveFrontmatter();
    void writeFrontmatterStatsForPair(
      this.app,
      fm,
      cohort,
      aFile,
      frame.a.id,
      bFile,
      frame.b.id,
    );
  }

  private findFileById(id: string): TFile | undefined {
    for (const [path, knownId] of this.idByPath) {
      if (knownId === id) {
        const af = this.app.vault.getAbstractFileByPath(path);
        if (af instanceof TFile) return af;
      }
    }
    return undefined;
  }

  // ---- Matchmaking helpers ----

  private getStatsForFile(file: TFile): { rating: number; matches: number } {
    const id = this.idByPath.get(file.path);
    const cohort = this.plugin.dataStore.store.cohorts[this.cohortKey];
    if (id && cohort) {
      const p = cohort.players[id];
      if (p) return { rating: p.rating, matches: p.matches };
    }
    // Unknown notes are treated as fresh
    return { rating: 1500, matches: 0 };
  }

  private weightedRandomIndex(weights: number[]): number {
    let sum = 0;
    for (const w of weights) sum += Math.max(0, w);
    if (sum <= 0) {
      return Math.floor(Math.random() * weights.length);
    }
    let r = Math.random() * sum;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  private pickAnchorIndex(): number {
    const mm = this.plugin.settings.matchmaking;
    if (!mm?.enabled || !mm.lowMatchesBias.enabled) {
      return Math.floor(Math.random() * this.files.length);
    }
    const exp = Math.max(0, Math.min(3, mm.lowMatchesBias.exponent));
    const weights = this.files.map((f) => {
      const s = this.getStatsForFile(f);
      return 1 / Math.pow(1 + Math.max(0, s.matches), Math.max(0.0001, exp));
    });
    return this.weightedRandomIndex(weights);
  }

  private pickOpponentIndex(anchorIdx: number): number {
    const n = this.files.length;
    const indices: number[] = [];
    for (let i = 0; i < n; i++) if (i !== anchorIdx) indices.push(i);

    const mm = this.plugin.settings.matchmaking;

    // If disabled, uniform random opponent (with a tiny guard for repeats below)
    if (!mm?.enabled) {
      return indices[Math.floor(Math.random() * indices.length)];
    }

    const anchorStats = this.getStatsForFile(this.files[anchorIdx]);

    // Choose a sample of candidates
    const sampleSize = mm.similarRatings.enabled
      ? Math.max(2, Math.min(mm.similarRatings.sampleSize || 12, indices.length))
      : Math.max(1, Math.min(12, indices.length));
    // Reservoir/sample style random pick without allocation costs
    const sample: number[] = [];
    let seen = 0;
    for (const idx of indices) {
      seen++;
      if (sample.length < sampleSize) {
        sample.push(idx);
      } else {
        const j = Math.floor(Math.random() * seen);
        if (j < sampleSize) sample[j] = idx;
      }
    }

    // Upset probe path: sometimes pick the largest gap above minGap
    if (mm.upsetProbes.enabled && Math.random() < Math.max(0, Math.min(1, mm.upsetProbes.probability))) {
      const minGap = Math.max(0, Math.round(mm.upsetProbes.minGap || 0));
      let bestIdx = -1;
      let bestGap = -1;
      for (const j of sample) {
        const s = this.getStatsForFile(this.files[j]);
        const gap = Math.abs(s.rating - anchorStats.rating);
        if (gap >= minGap && gap > bestGap) {
          bestGap = gap;
          bestIdx = j;
        }
      }
      // Fall through to similar-ratings if no candidate met min gap
      if (bestIdx >= 0) return bestIdx;
    }

    // Similar-ratings path: pick the minimal rating difference (tie-break: fewer matches)
    if (mm.similarRatings.enabled) {
      let bestIdx = sample[0];
      let bestGap = Number.POSITIVE_INFINITY;
      let bestMatches = Number.POSITIVE_INFINITY;
      for (const j of sample) {
        const s = this.getStatsForFile(this.files[j]);
        const gap = Math.abs(s.rating - anchorStats.rating);
        if (gap < bestGap) {
          bestGap = gap;
          bestIdx = j;
          bestMatches = s.matches;
        } else if (gap === bestGap && s.matches < bestMatches) {
          bestIdx = j;
          bestMatches = s.matches;
        }
      }
      return bestIdx;
    }

    // Default fallback: random from the sample
    return sample[Math.floor(Math.random() * sample.length)];
  }

  private pickNextPair() {
    if (this.files.length < 2) {
      this.leftFile = this.rightFile = undefined;
      return;
    }
  
    // Always use the helpers; they internally handle the "disabled = random" cases.
    const aIdx = this.pickAnchorIndex();
    let bIdx = this.pickOpponentIndex(aIdx);
  
    // Avoid repeating the exact same pair if possible
    const currentSig = pairSig(this.files[aIdx].path, this.files[bIdx].path);
    if (this.lastPairSig === currentSig && this.files.length >= 3) {
      let guard = 0;
      while (guard++ < 10) {
        const alt = this.pickOpponentIndex(aIdx);
        if (alt !== bIdx) {
          const altSig = pairSig(this.files[aIdx].path, this.files[alt].path);
          if (altSig !== this.lastPairSig) {
            bIdx = alt;
            break;
          }
        }
      }
    }
  
    // Randomise left/right for balance
    if (Math.random() < 0.5) {
      this.leftFile = this.files[aIdx];
      this.rightFile = this.files[bIdx];
    } else {
      this.leftFile = this.files[bIdx];
      this.rightFile = this.files[aIdx];
    }
    this.lastPairSig = pairSig(this.leftFile.path, this.rightFile.path);
  }
}
