import type { App, ViewState, WorkspaceLeaf } from 'obsidian';
import { Notice } from 'obsidian';

import type { SessionLayoutMode } from '../settings';
import { attempt, attemptAsync } from '../utils/safe';

export type ArenaLayoutHandle = {
  leftLeaf: WorkspaceLeaf;
  rightLeaf: WorkspaceLeaf;
  doc: Document;
  win: Window;
  cleanup: () => Promise<void>;
};

export class ArenaLayoutManager {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  create(mode: SessionLayoutMode): Promise<ArenaLayoutHandle> {
    switch (mode) {
      case 'right-split':
        return Promise.resolve(this.createRightSplit());
      case 'new-tab':
        return Promise.resolve(this.createNewTab());
      case 'new-window':
        return this.createNewWindow();
      case 'reuse-active':
      default:
        return Promise.resolve(this.createReuseActive());
    }
  }

  private getUserLeaf(): WorkspaceLeaf {
    return this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(false);
  }

  private snapshot(vs: ViewState | undefined): ViewState | undefined {
    if (!vs) return undefined;

    const stateRaw: unknown = (vs as { state?: unknown }).state;
    const safeState: Record<string, unknown> =
      stateRaw && typeof stateRaw === 'object' ? { ...(stateRaw as Record<string, unknown>) } : {};

    return {
      ...vs,
      state: safeState,
    };
  }

  private resolveDocWinFromLeaf(leaf: WorkspaceLeaf): { doc: Document; win: Window } {
    const doc =
      leaf.view.containerEl.ownerDocument ??
      this.app.workspace.containerEl.ownerDocument ??
      document;
    const win = doc.defaultView ?? window;
    return { doc, win };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  /**
   * Obsidian may return a popout leaf before it is actually attached to the
   * popout window's DOM. If we split too early, the split can occur in the
   * main window.
   */
  private async waitForPopoutLeafAttachment(
    popoutLeaf: WorkspaceLeaf,
    timeoutMs = 5000,
    pollMs = 50,
  ): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const { win } = this.resolveDocWinFromLeaf(popoutLeaf);
      if (win !== window) return;
      await this.sleep(pollMs);
    }
  }

  // Mode: reuse-active
  // Use the user's active leaf as the arena's left; split it to create the right.
  private createReuseActive(): ArenaLayoutHandle {
    const leftLeaf = this.getUserLeaf();
    const originalLeftViewState = this.snapshot(leftLeaf.getViewState());

    attempt(() => this.app.workspace.setActiveLeaf(leftLeaf, { focus: false }));

    const rightLeaf = this.app.workspace.getLeaf('split');

    const cleanup = async () => {
      // Restore the user's original tab state
      if (originalLeftViewState) {
        await attemptAsync(() => leftLeaf.setViewState({ ...originalLeftViewState, active: true }));
      }
      // Close the right leaf if we created it
      if (rightLeaf && rightLeaf !== leftLeaf) {
        attempt(() => rightLeaf.detach());
      }
      // Return focus to the user's leaf
      attempt(() => this.app.workspace.setActiveLeaf(leftLeaf, { focus: true }));
      // Yield so UI teardown and any notices can settle
      await new Promise<void>((r) => window.setTimeout(r, 0));
    };

    const { doc, win } = this.resolveDocWinFromLeaf(leftLeaf);
    return { leftLeaf, rightLeaf, cleanup, doc, win };
  }

  // Mode: right-split
  // Keep the user's current pane visible. Create two arena panes to the right.
  private createRightSplit(): ArenaLayoutHandle {
    const referenceLeaf = this.getUserLeaf();

    // First split: create arena-right to the right
    attempt(() => this.app.workspace.setActiveLeaf(referenceLeaf, { focus: false }));
    const arenaRight = this.app.workspace.getLeaf('split');

    // Second split: split the arena-right to create arena-left
    attempt(() => this.app.workspace.setActiveLeaf(arenaRight, { focus: false }));
    const arenaLeft = this.app.workspace.getLeaf('split');

    // Focus the arena so keyboard works immediately
    attempt(() => this.app.workspace.setActiveLeaf(arenaLeft, { focus: true }));

    const cleanup = async () => {
      // Close the two arena panes we created
      if (arenaRight && arenaRight !== arenaLeft) {
        attempt(() => arenaRight.detach());
      }
      if (arenaLeft && arenaLeft !== referenceLeaf) {
        attempt(() => arenaLeft.detach());
      }
      // Return focus to the reference
      attempt(() => this.app.workspace.setActiveLeaf(referenceLeaf, { focus: true }));
      // Yield so UI teardown and any notices can settle
      await new Promise<void>((r) => window.setTimeout(r, 0));
    };

    const { doc, win } = this.resolveDocWinFromLeaf(arenaLeft);
    return { leftLeaf: arenaLeft, rightLeaf: arenaRight, cleanup, doc, win };
  }

  // Mode: new-tab
  // Create a new tab for the arena's left leaf, then split that tab for right.
  private createNewTab(): ArenaLayoutHandle {
    const referenceLeaf = this.getUserLeaf();

    const left = this.app.workspace.getLeaf('tab');

    attempt(() => this.app.workspace.setActiveLeaf(left, { focus: false }));
    const right = this.app.workspace.getLeaf('split');

    // Focus the arena
    attempt(() => this.app.workspace.setActiveLeaf(left, { focus: true }));

    const cleanup = async () => {
      if (right && right !== left) {
        attempt(() => right.detach());
      }
      attempt(() => left.detach());
      attempt(() => this.app.workspace.setActiveLeaf(referenceLeaf, { focus: true }));
      // Yield so UI teardown and any notices can settle
      await new Promise<void>((r) => window.setTimeout(r, 0));
    };

    const { doc, win } = this.resolveDocWinFromLeaf(left);
    return { leftLeaf: left, rightLeaf: right, cleanup, doc, win };
  }

  // Mode: new-window
  // Open a pop-out window (if available), then split inside it.
  private async createNewWindow(): Promise<ArenaLayoutHandle> {
    const referenceLeaf = this.getUserLeaf();

    const wsWithFn = this.app.workspace as { openPopoutLeaf: () => WorkspaceLeaf | undefined };
    const popLeft: WorkspaceLeaf | undefined = wsWithFn.openPopoutLeaf();

    if (!popLeft) {
      new Notice('Failed to open a new window. Using right-side split instead.');
      return this.createRightSplit();
    }

    await this.waitForPopoutLeafAttachment(popLeft);

    // Make sure subsequent splits happen in the pop-out
    attempt(() => this.app.workspace.setActiveLeaf(popLeft, { focus: true }));

    let popRight = this.app.workspace.getLeaf('split');
    const createdRight = !!popRight && popRight !== popLeft;
    if (!createdRight) {
      const tab = this.app.workspace.getLeaf('tab');
      popRight = tab && tab !== popLeft ? tab : popLeft;
    }

    const cleanup = async () => {
      // Detach inside the popout; detaching the last leaf should close the window.
      if (popRight && popRight !== popLeft) {
        attempt(() => popRight.detach());
      }
      attempt(() => popLeft.detach());
      attempt(() => this.app.workspace.setActiveLeaf(referenceLeaf, { focus: true }));
      // Yield so UI teardown and any notices can settle
      await new Promise<void>((r) => window.setTimeout(r, 0));
    };

    const { doc, win } = this.resolveDocWinFromLeaf(popLeft);
    return { leftLeaf: popLeft, rightLeaf: popRight, cleanup, doc, win };
  }
}
