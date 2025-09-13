import { App, MarkdownView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { ArenaLayoutHandle, ArenaLayoutManager } from './LayoutManager';
import { MatchResult, ScrollStartMode, UndoFrame } from '../types';
import { ensureEloId, getEloId } from '../utils/NoteIds';

import type EloPlugin from '../main';
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
  private overlayWin?: Window;
  private popoutUnloadHandler?: () => void;
  private keydownHandler = (ev: KeyboardEvent) => this.onKeydown(ev);

  private layoutHandle?: ArenaLayoutHandle;

  private liveNotices: Notice[] = [];

  constructor(app: App, plugin: EloPlugin, cohortKey: string, files: TFile[]) {
    this.app = app;
    this.plugin = plugin;
    this.cohortKey = cohortKey;
    this.files = files.slice();
  }

  async start() {
    // Create arena layout per settings
    const mgr = new ArenaLayoutManager(this.app);
    this.layoutHandle = await mgr.create(this.plugin.settings.sessionLayout ?? 'new-tab');

    this.leftLeaf = this.layoutHandle.leftLeaf;
    this.rightLeaf = this.layoutHandle.rightLeaf;

    // Resolve the correct document/window for UI and keyboard capture.
    const doc =
      this.leftLeaf.view?.containerEl?.ownerDocument ??
      this.rightLeaf.view?.containerEl?.ownerDocument ??
      this.layoutHandle.doc ??
      document;
    const win = doc.defaultView ?? this.layoutHandle.win ?? window;

    this.overlayWin = win;

    // Pin both leaves during the session
    try { this.leftLeaf.setPinned(true); } catch {
      // Non-fatal: pinning may not exist on this version or the leaf may be disposed. Ignore.
    }
    try { this.rightLeaf.setPinned(true); } catch {
      // Non-fatal: pinning may not exist on this version or the leaf may be disposed. Ignore.
    }

    this.mountOverlay(doc);
    this.plugin.registerDomEvent(win, 'keydown', this.keydownHandler, true);

    // If the user closes a pop-out window, end the session automatically.
    if (win !== window) {
      this.popoutUnloadHandler = () => this.plugin.endSession();
      this.plugin.registerDomEvent(win, 'beforeunload', this.popoutUnloadHandler);
    }
  
    this.pickNextPair();
    this.updateOverlay();
    await this.openCurrent();
  }

  async end(opts?: { forUnload?: boolean }) {
    // Remove listeners from the correct window
    if (this.overlayWin) {
      try { this.overlayWin.removeEventListener('keydown', this.keydownHandler, true); } catch {
        // Non-fatal: pop-out window may already be closed or listener already removed. Ignore.
      }
      if (this.popoutUnloadHandler) {
        try { this.overlayWin.removeEventListener('beforeunload', this.popoutUnloadHandler); } catch {
          // Non-fatal: pop-out window may already be closed or listener already removed. Ignore.
        }
        // Hide any toast we created while in the popout (so they don't reattach to the main window)
        try { for (const n of this.liveNotices) { (n as Notice)?.hide?.(); } } catch {
          // Non-fatal: notice handles may belong to another window or be disposed. Ignore.
        }
      }
    }
    this.popoutUnloadHandler = undefined;

    this.unmountOverlay();

    // Unpin leaves
    try { this.leftLeaf.setPinned(false); } catch {
      // Non-fatal: leaf may already be gone or API unavailable. Ignore.
    }
    try { this.rightLeaf.setPinned(false); } catch {
      // Non-fatal: leaf may already be gone or API unavailable. Ignore.
    }
  
    // Only detach/cleanup panes when not unloading the plugin (as per guidelines)
    if (!opts?.forUnload) {
      try { await this.layoutHandle?.cleanup(); } catch {
        // Non-fatal: cleanup is best-effort; panes may already be detached. Ignore.
      }
    }

    this.liveNotices = [];
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

  private getCohortScrollStart(): ScrollStartMode {
    const def = this.plugin.dataStore.getCohortDef(this.cohortKey);
    return def?.scrollStart ?? 'none';
  }

  private async openInReadingMode(leaf: WorkspaceLeaf, file: TFile) {
    // Force Reading Mode and prevent focus grabbing
    await leaf.setViewState({
      type: 'markdown',
      state: { file: file.path, mode: 'preview' },
      active: false,
    });

    // Safety: if somehow still in edit mode, flip to preview again
    const v = leaf.view instanceof MarkdownView ? leaf.view : undefined;
    if (v && v.getMode() !== 'preview') {
      try {
        await leaf.setViewState({
          type: 'markdown',
          state: { file: file.path, mode: 'preview' },
          active: false,
        });
      } catch {
        // Non-fatal: view may have been disposed or replaced between checks. Ignore.
      }
    }

    // Apply initial scroll behaviour
    const mode = this.getCohortScrollStart();
    void this.applyInitialScroll(leaf, mode);
  }

  private async applyInitialScroll(leaf: WorkspaceLeaf, mode: ScrollStartMode): Promise<void> {
  if (mode === 'none') return;
  const v = leaf.view;
  if (!(v instanceof MarkdownView)) return;

  // Retry briefly while content renders for all modes, including after-frontmatter
  const maxTries = 30;
  const stepMs = 100;
  for (let i = 0; i < maxTries; i++) {
    if (this.tryScrollView(v, mode)) return;
    await this.sleep(stepMs);
  }
}

  private tryScrollView(view: MarkdownView, mode: ScrollStartMode): boolean {
    const preview = this.getPreviewEl(view);
    if (!preview) return false;
  
    const root = this.getRenderedRoot(preview);
  
    const findHeading = (): HTMLElement | null =>
      (root.querySelector('h1, h2, h3, h4, h5, h6') as HTMLElement | null);
    const findImage = (): HTMLElement | null =>
      (root.querySelector('img') as HTMLElement | null);
  
    if (mode === 'after-frontmatter') {
      return this.scrollPastFrontmatter(preview);
    }
  
    let target: HTMLElement | null = null;
    if (mode === 'first-image') {
      target = findImage() || findHeading();
    } else if (mode === 'first-heading') {
      target = findHeading();
    }
  
    if (target) {
      try {
        target.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
      } catch {
        // Non-fatal: scrollIntoView may fail if the element is not in the DOM. Ignore.
      }
      return true;
    }
    return false;
  }

  private getPreviewEl(view: MarkdownView): HTMLElement | null {
    const scope = view.contentEl ?? view.containerEl;
    return (
      (scope.querySelector('.markdown-reading-view .markdown-preview-view') as HTMLElement | null) ??
      (scope.querySelector('.markdown-preview-view') as HTMLElement | null)
    );
  }

  private getRenderedRoot(preview: HTMLElement): HTMLElement {
    return (
      (preview.querySelector('.markdown-preview-sizer') as HTMLElement | null) ??
      (preview.querySelector('.markdown-rendered') as HTMLElement | null) ??
      preview
    );
  }

  private scrollToTop(preview: HTMLElement): void {
    try {
      preview.scrollTo({ top: 0, behavior: 'auto' });
    } catch {
      try { preview.scrollTop = 0; } catch {
        // Non-fatal: scrollTop may fail if the element is not in the DOM. Ignore.
      }
    }
  }

  private scrollPastFrontmatter(preview: HTMLElement): boolean {
    const root = this.getRenderedRoot(preview);
      
    // Scroll to the first real content element after the properties/frontmatter block
    let next = root.querySelector(
      ':scope > :has(.metadata-container, .frontmatter-container, .frontmatter, pre.frontmatter) ~ *'
    ) as HTMLElement | null;
    
    while (next && next.offsetHeight <= 0) {
      next = next.nextElementSibling as HTMLElement | null;
    }
    
    if (next) {
      try {
        next.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
        return true;
      } catch {
        // Non-fatal: scrollIntoView may fail if the element is not in the DOM. Ignore.
      }
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private mountOverlay(doc: Document = document) {
    const el = doc.body.createDiv({ cls: 'elo-session-bar' });

    el.createDiv({ cls: 'elo-side left' });

    const controls = el.createDiv({ cls: 'elo-controls' });
    controls.append(
      this.makeButton(doc, '← Left', () => this.choose('A')),
      this.makeButton(doc, '↑ Draw', () => this.choose('D')),
      this.makeButton(doc, '→ Right', () => this.choose('B')),
      this.makeButton(doc, 'Undo ⌫', () => this.undo()),
      this.makeButton(doc, 'End Esc', () => this.plugin.endSession()),
    );

    el.createDiv({ cls: 'elo-side right' });

    this.overlayEl = el;
    this.updateOverlay();
  }

  private unmountOverlay() {
    if (this.overlayEl?.isConnected) this.overlayEl.remove();
    this.overlayEl = undefined;
  }

  private makeButton(doc: Document, text: string, onClick: () => void) {
    const btn = doc.createElement('button');
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

  private showToast(message: string, timeout = 4000): void {
    try {
      this.liveNotices.push(new Notice(message, timeout));
    } catch {
      // Non-fatal: constructing a Notice can fail in pop-outs or during teardown. Ignore.
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
      if (result === 'A') this.showToast(`Winner: ${this.leftFile.basename}`);
      else if (result === 'B') this.showToast(`Winner: ${this.rightFile.basename}`);
      else this.showToast('Draw');
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
      this.showToast('Nothing to undo.');
      return;
    }
    if (this.plugin.dataStore.revert(frame)) this.showToast('Undid last match.');
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
