import { App, TFile, WorkspaceLeaf } from 'obsidian';

const READY_TIMEOUT_MS = 20_000;
const RUN_TIMEOUT_MS = 20_000;

// Consider the query "settled" once we've observed post-run activity and then
// observed this many consecutive animation frames with no further activity
const SETTLE_QUIET_FRAMES = 4;

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function nowMs(): number {
  return window.performance?.now?.() ?? Date.now();
}

function getActiveLeafSafe(app: App): WorkspaceLeaf | null {
  const ws: any = app.workspace as any;

  const active = ws.activeLeaf;
  if (active) return active as WorkspaceLeaf;

  if (typeof ws.getMostRecentLeaf === 'function') {
    const mr = ws.getMostRecentLeaf();
    if (mr) return mr as WorkspaceLeaf;
  }

  if (typeof ws.getLeaf === 'function') {
    const leaf = ws.getLeaf(false);
    if (leaf) return leaf as WorkspaceLeaf;
  }

  return null;
}

async function openBaseLeafInBackground(app: App, baseFile: TFile, viewName: string): Promise<WorkspaceLeaf> {
  const leaf = app.workspace.getLeaf('tab');
  if (!leaf) throw new Error('[Elo][Bases] Could not create a workspace leaf');

  await leaf.openFile(baseFile, { active: false } as any);

  await leaf.setViewState(
    {
      type: 'bases',
      state: { file: baseFile.path, viewName },
      active: false,
    } as any,
    { focus: false } as any,
  );

  return leaf;
}

async function withTemporarilyActiveLeaf<T>(
  app: App,
  leafToActivate: WorkspaceLeaf,
  previousLeaf: WorkspaceLeaf | null,
  fn: () => Promise<T>,
): Promise<T> {
  app.workspace.setActiveLeaf(leafToActivate, { focus: true } as any);

  // Bases appears to require the leaf to be visible/active (mount/resize observers)
  await nextFrame();
  await nextFrame();

  try {
    return await fn();
  } finally {
    if (previousLeaf && previousLeaf !== leafToActivate) {
      app.workspace.setActiveLeaf(previousLeaf, { focus: true } as any);
      await nextFrame();
    }
  }
}

async function awaitControllerReady(
  controller: any,
  basePath: string,
  viewName: string,
  timeoutMs: number,
): Promise<void> {
  const started = nowMs();

  while (nowMs() - started < timeoutMs) {
    const curFileOk = controller?.currentFile?.path === basePath;
    const hasQuery = !!controller?.query;
    const queryStateOk = typeof controller?.queryState === 'string' && controller.queryState.length > 0;

    let viewNameOk = true;
    if (typeof controller?.getQueryViewNames === 'function') {
      try {
        const names = controller.getQueryViewNames();
        if (Array.isArray(names) && names.length > 0) {
          viewNameOk = names.includes(viewName);
        }
      } catch {
        viewNameOk = false;
      }
    }

    if (curFileOk && hasQuery && queryStateOk && viewNameOk) return;

    await nextFrame();
  }

  throw new Error('[Elo][Bases] Timed out waiting for Bases controller readiness');
}

type InstrumentState = {
  armed: boolean;
  activityCount: number;
};

function instrumentControllerForActivity(controller: any): { state: InstrumentState; unpatch: () => void } {
  const state: InstrumentState = {
    armed: false,
    activityCount: 0,
  };

  const unpatches: Array<() => void> = [];

  const mark = () => {
    if (!state.armed) return;
    state.activityCount += 1;
  };

  const patchFn = (obj: any, key: string) => {
    const orig = obj?.[key];
    if (typeof orig !== 'function') return;

    obj[key] = function (...args: any[]) {
      mark();
      return orig.apply(this, args);
    };

    unpatches.push(() => {
      obj[key] = orig;
    });
  };

  // Internal points observed changing when Bases actually runs
  patchFn(controller, 'addResult');
  patchFn(controller, 'removeResult');
  patchFn(controller, 'requestNotifyView');
  patchFn(controller, 'stopLoader');

  return {
    state,
    unpatch: () => {
      for (const u of unpatches.reverse()) {
        try {
          u();
        } catch {
          // ignore
        }
      }
    },
  };
}

async function runQueryAndWaitForSettle(controller: any, viewName: string, timeoutMs: number): Promise<void> {
  const { state, unpatch } = instrumentControllerForActivity(controller);

  try {
    if (typeof controller.selectView !== 'function') {
      throw new Error('[Elo][Bases] controller.selectView is not a function (Bases internals changed)');
    }
    controller.selectView(viewName);

    const hasSetQueryAndView = typeof controller.setQueryAndView === 'function';
    const hasRunQuery = typeof controller.runQuery === 'function';

    if (!hasSetQueryAndView && !hasRunQuery) {
      throw new Error('[Elo][Bases] No controller.setQueryAndView or controller.runQuery (Bases internals changed)');
    }

    state.armed = true;

    // Kick the run (prefer the higher-level API).
    if (hasSetQueryAndView) {
      controller.setQueryAndView(controller.query, viewName);
    } else {
      controller.runQuery();
    }

    const deadline = nowMs() + timeoutMs;

    let activityObserved = false;
    let quietFrames = 0;

    // Also detect changes even if Bases swaps the results Map without calling patched methods.
    let lastResultsMap = controller?.results;
    let lastResultsSize = lastResultsMap instanceof Map ? lastResultsMap.size : 0;
    let lastActivityCount = state.activityCount;

    while (nowMs() < deadline) {
      await nextFrame();

      const curMap = controller?.results;
      const curSize = curMap instanceof Map ? curMap.size : 0;

      const mapChanged = curMap !== lastResultsMap;
      const sizeChanged = curSize !== lastResultsSize;
      const hookActivity = state.activityCount !== lastActivityCount;

      if (mapChanged || sizeChanged || hookActivity) {
        activityObserved = true;
        quietFrames = 0;

        lastResultsMap = curMap;
        lastResultsSize = curSize;
        lastActivityCount = state.activityCount;
        continue;
      }

      if (activityObserved) {
        quietFrames += 1;
        if (quietFrames >= SETTLE_QUIET_FRAMES) return;
      }
    }

    throw new Error('[Elo][Bases] Timed out waiting for Bases query to settle');
  } finally {
    unpatch();
  }
}

function extractMarkdownFilesFromControllerResults(controller: any): TFile[] {
  const results: unknown = controller?.results;
  if (!(results instanceof Map)) return [];

  const out: TFile[] = [];
  for (const k of results.keys()) {
    if (k instanceof TFile && k.extension.toLowerCase() === 'md') out.push(k);
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Resolve Markdown files from a Bases (.base) file + view name by temporarily opening
 * the Base, activating its leaf (required for Bases to run reliably), running the query,
 * waiting for results to settle, extracting `TFile`s, then cleaning up.
 */
export async function resolveFilesFromBaseView(
  app: App,
  basePath: string,
  viewName: string,
  opts?: { readyTimeoutMs?: number; runTimeoutMs?: number },
): Promise<TFile[]> {
  const af = app.vault.getAbstractFileByPath(basePath);
  if (!(af instanceof TFile) || af.extension.toLowerCase() !== 'base') {
    throw new Error(`[Elo][Bases] Not a .base file: ${basePath}`);
  }
  const baseFile = af;

  const previousLeaf = getActiveLeafSafe(app);

  let leaf: WorkspaceLeaf | null = null;

  try {
    leaf = await openBaseLeafInBackground(app, baseFile, viewName);

    const view: any = leaf.view;
    if (view?.getViewType?.() !== 'bases') {
      throw new Error(`[Elo][Bases] Unexpected view type: ${String(view?.getViewType?.())}`);
    }

    return await withTemporarilyActiveLeaf(app, leaf, previousLeaf, async () => {
      await nextFrame();

      const controller: any = (leaf as any).view?.controller;
      if (!controller) throw new Error('[Elo][Bases] Bases controller missing on view');

      await awaitControllerReady(
        controller,
        baseFile.path,
        viewName,
        opts?.readyTimeoutMs ?? READY_TIMEOUT_MS,
      );

      // These appear to matter when running in a just-opened leaf.
      if (typeof controller.updateCurrentFile === 'function') {
        try {
          controller.updateCurrentFile();
        } catch {
          // ignore
        }
      }
      if (typeof controller.onResize === 'function') {
        try {
          controller.onResize();
        } catch {
          // ignore
        }
      }

      await runQueryAndWaitForSettle(controller, viewName, opts?.runTimeoutMs ?? RUN_TIMEOUT_MS);

      return extractMarkdownFilesFromControllerResults(controller);
    });
  } finally {
    try {
      leaf?.detach();
    } catch {
      // ignore
    }
  }
}
