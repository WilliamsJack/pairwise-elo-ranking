import { App, Notice, ViewState, WorkspaceLeaf } from 'obsidian';
import { attempt, attemptAsync } from '../utils/safe';

import type { SessionLayoutMode } from '../settings';

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
        return Promise.resolve(this.createNewWindow());
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
    return {
      ...vs,
      state: vs.state ? JSON.parse(JSON.stringify(vs.state)) : {},
    };
  }

  private resolveDocWinFromLeaf(leaf: WorkspaceLeaf): { doc: Document; win: Window } {
    const doc =
      leaf.view?.containerEl?.ownerDocument ??
      this.app.workspace.containerEl.ownerDocument ??
      document;
    const win = doc.defaultView ?? window;
    return { doc, win };
  }

  // Mode: reuse-active
  // Use the user's active leaf as the arena's left; split it to create the right.
  private createReuseActive(): ArenaLayoutHandle {
    const leftLeaf = this.getUserLeaf();
    const originalLeftViewState = this.snapshot(leftLeaf.getViewState());

    attempt(() => this.app.workspace.setActiveLeaf(leftLeaf, { focus: false }));

    let rightLeaf = this.app.workspace.getLeaf('split');
    const createdRight = !!rightLeaf && rightLeaf !== leftLeaf;

    if (!createdRight) {
      // Fallback: new tab in same group, then split that
      const newTab = this.app.workspace.getLeaf('tab');
      if (newTab && newTab !== leftLeaf) {
        attempt(() => this.app.workspace.setActiveLeaf(newTab, { focus: false }));
        const split = this.app.workspace.getLeaf('split');
        if (split && split !== newTab) {
          rightLeaf = split;
        } else {
          rightLeaf = newTab;
        }
      } else {
        rightLeaf = leftLeaf;
      }
    }

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
      await new Promise<void>((r) => setTimeout(r, 0));
    };

    const { doc, win } = this.resolveDocWinFromLeaf(leftLeaf);
    return { leftLeaf, rightLeaf, cleanup, doc, win };
  }

  // Mode: right-split
  // Keep the user's current pane visible. Create two arena panes to the right.
  private createRightSplit(): ArenaLayoutHandle {
    const referenceLeaf = this.getUserLeaf();

    // First split: create arena-left to the right
    attempt(() => this.app.workspace.setActiveLeaf(referenceLeaf, { focus: false }));
    let arenaLeft = this.app.workspace.getLeaf('split');
    const createdLeft = !!arenaLeft && arenaLeft !== referenceLeaf;

    if (!createdLeft) {
      // Fallback: create a new tab (still keeps reference visible in its own tab)
      const newTab = this.app.workspace.getLeaf('tab');
      if (newTab && newTab !== referenceLeaf) {
        arenaLeft = newTab;
      } else {
        // Ultimate fallback: reuse-active
        return this.createReuseActive();
      }
    }

    // Second split: split the arena-left to create arena-right
    attempt(() => this.app.workspace.setActiveLeaf(arenaLeft, { focus: false }));
    let arenaRight = this.app.workspace.getLeaf('split');
    const createdRight = !!arenaRight && arenaRight !== arenaLeft;

    if (!createdRight) {
      // Fallback: try another tab; otherwise, duplicate left
      const tab = this.app.workspace.getLeaf('tab');
      arenaRight = (tab && tab !== arenaLeft) ? tab : arenaLeft;
    }

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
      await new Promise<void>((r) => setTimeout(r, 0));
    };

    const { doc, win } = this.resolveDocWinFromLeaf(arenaLeft);
    return { leftLeaf: arenaLeft, rightLeaf: arenaRight, cleanup, doc, win };
  }

  // Mode: new-tab
  // Create a new tab for the arena's left leaf, then split that tab for right.
  private createNewTab(): ArenaLayoutHandle {
    const referenceLeaf = this.getUserLeaf();

    const left = this.app.workspace.getLeaf('tab');
    if (!left) {
      // Fallback to reuse-active if tab creation failed
      return this.createReuseActive();
    }

    attempt(() => this.app.workspace.setActiveLeaf(left, { focus: false }));
    let right = this.app.workspace.getLeaf('split');
    const createdRight = !!right && right !== left;

    if (!createdRight) {
      // Fallback: at least try to create a distinct second leaf
      const tab = this.app.workspace.getLeaf('tab');
      right = (tab && tab !== left) ? tab : left;
    }

    // Focus the arena
    attempt(() => this.app.workspace.setActiveLeaf(left, { focus: true }));

    const cleanup = async () => {
      if (right && right !== left) {
        attempt(() => right.detach());
      }
      attempt(() => left.detach());
      attempt(() => this.app.workspace.setActiveLeaf(referenceLeaf, { focus: true }));
      // Yield so UI teardown and any notices can settle
      await new Promise<void>((r) => setTimeout(r, 0));
    };

    const { doc, win } = this.resolveDocWinFromLeaf(left);
    return { leftLeaf: left, rightLeaf: right, cleanup, doc, win };
  }

  // Mode: new-window
  // Open a pop-out window (if available), then split inside it.
  private createNewWindow(): ArenaLayoutHandle {
    const referenceLeaf = this.getUserLeaf();

    const openPopout = this.app.workspace.openPopoutLeaf?.bind(this.app.workspace);
    if (typeof openPopout !== 'function') {
      new Notice('Pop-out windows are not supported in this Obsidian version. Using right-side split instead.');
      return this.createRightSplit();
    }

    const popLeft: WorkspaceLeaf | undefined = openPopout();
    if (!popLeft) {
      new Notice('Failed to open a new window. Using right-side split instead.');
      return this.createRightSplit();
    }

    // Make sure subsequent splits happen in the pop-out
    attempt(() => this.app.workspace.setActiveLeaf(popLeft, { focus: true }));

    let popRight = this.app.workspace.getLeaf('split');
    const createdRight = !!popRight && popRight !== popLeft;
    if (!createdRight) {
      const tab = this.app.workspace.getLeaf('tab');
      popRight = (tab && tab !== popLeft) ? tab : popLeft;
    }

    const cleanup = async () => {
      // Detach inside the popout; detaching the last leaf should close the window.
      if (popRight && popRight !== popLeft) {
        attempt(() => popRight.detach());
      }
      attempt(() => popLeft.detach());
      attempt(() => this.app.workspace.setActiveLeaf(referenceLeaf, { focus: true }));
      // Yield so UI teardown and any notices can settle
      await new Promise<void>((r) => setTimeout(r, 0));
    };

    const { doc, win } = this.resolveDocWinFromLeaf(popLeft);
    return { leftLeaf: popLeft, rightLeaf: popRight, cleanup, doc, win };
  }
}
