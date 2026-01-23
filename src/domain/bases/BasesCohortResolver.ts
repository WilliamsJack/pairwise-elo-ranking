import { App, OpenViewState, TFile, ViewState, WorkspaceLeaf } from 'obsidian';

import { attempt } from '../../utils/safe';

const READY_TIMEOUT_MS = 20_000;
const RUN_TIMEOUT_MS = 20_000;

// Consider the query "settled" once we've observed post-run activity and then
// observed this many consecutive animation frames with no further activity
const SETTLE_QUIET_FRAMES = 4;

type ResolveOpts = { readyTimeoutMs?: number; runTimeoutMs?: number };

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function nowMs(): number {
  return window.performance?.now?.() ?? Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

type ControllerFn = (this: unknown, ...args: unknown[]) => unknown;

// Minimal model of Bases controller internals
type BasesControllerLike = {
  currentFile?: unknown;
  query?: unknown;
  queryState?: unknown;
  results?: unknown;

  selectView?: (viewName: string) => void;
  setQueryAndView?: (query: unknown, viewName: string) => void;
  getQueryViewNames?: () => unknown;

  updateCurrentFile?: () => void;
  onResize?: () => void;

  // Patch points used for activity detection
  addResult?: ControllerFn;
  removeResult?: ControllerFn;
  requestNotifyView?: ControllerFn;
  stopLoader?: ControllerFn;
};

function getBasesControllerFromLeaf(leaf: WorkspaceLeaf): BasesControllerLike | undefined {
  const viewUnknown: unknown = leaf.view;
  if (!isRecord(viewUnknown)) return undefined;

  const controllerUnknown = viewUnknown['controller'];
  if (!isRecord(controllerUnknown)) return undefined;

  return controllerUnknown as BasesControllerLike;
}

function getUserLeaf(app: App): WorkspaceLeaf | null {
  return app.workspace.getMostRecentLeaf?.() ?? app.workspace.getLeaf(false);
}

async function openBaseLeaf(app: App, baseFile: TFile, viewName: string): Promise<WorkspaceLeaf> {
  const leaf = app.workspace.getLeaf('tab');
  if (!leaf) throw new Error('[Elo][Bases] Could not create a workspace leaf');

  const openState: OpenViewState = { active: true };
  await leaf.openFile(baseFile, openState);

  const vs: ViewState = {
    type: 'bases',
    state: { file: baseFile.path, viewName },
    active: true,
  };
  await leaf.setViewState(vs);

  app.workspace.setActiveLeaf(leaf, { focus: true });

  await nextFrame();
  await nextFrame();

  return leaf;
}

function controllerHasViewName(controller: BasesControllerLike, viewName: string): boolean {
  if (typeof controller.getQueryViewNames !== 'function') return true;

  try {
    const names = controller.getQueryViewNames();
    if (!isStringArray(names)) return false;
    if (names.length === 0) return true;
    return names.includes(viewName);
  } catch {
    return false;
  }
}

async function awaitControllerReady(
  controller: BasesControllerLike,
  basePath: string,
  viewName: string,
  timeoutMs: number,
): Promise<void> {
  const started = nowMs();

  while (nowMs() - started < timeoutMs) {
    const curFile = controller.currentFile;
    const curFileOk = curFile instanceof TFile && curFile.path === basePath;

    const hasQuery = typeof controller.query !== 'undefined';

    const qs = controller.queryState;
    const queryStateOk = typeof qs === 'string' && qs.length > 0;

    const viewNameOk = controllerHasViewName(controller, viewName);

    if (curFileOk && hasQuery && queryStateOk && viewNameOk) return;

    await nextFrame();
  }

  throw new Error('[Elo][Bases] Timed out waiting for Bases controller readiness');
}

type InstrumentState = {
  armed: boolean;
  activityCount: number;
};

type PatchKey = 'addResult' | 'removeResult' | 'requestNotifyView' | 'stopLoader';

function patchControllerMethod(
  controller: BasesControllerLike,
  key: PatchKey,
  mark: () => void,
): () => void {
  const original = controller[key];
  if (typeof original !== 'function') return () => {};

  const wrapped: ControllerFn = function (this: unknown, ...args: unknown[]) {
    mark();
    return Reflect.apply(original, this, args);
  };

  controller[key] = wrapped;

  return () => {
    controller[key] = original;
  };
}

function instrumentControllerForActivity(controller: BasesControllerLike): { state: InstrumentState; unpatch: () => void } {
  const state: InstrumentState = { armed: false, activityCount: 0 };
  const unpatches: Array<() => void> = [];

  const mark = () => {
    if (!state.armed) return;
    state.activityCount += 1;
  };

  unpatches.push(patchControllerMethod(controller, 'addResult', mark));
  unpatches.push(patchControllerMethod(controller, 'removeResult', mark));
  unpatches.push(patchControllerMethod(controller, 'requestNotifyView', mark));
  unpatches.push(patchControllerMethod(controller, 'stopLoader', mark));

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

function getResultsMap(controller: BasesControllerLike): Map<unknown, unknown> | undefined {
  const results = controller.results;
  return results instanceof Map ? results : undefined;
}

async function runQueryAndWaitForSettle(controller: BasesControllerLike, viewName: string, timeoutMs: number): Promise<void> {
  const { state, unpatch } = instrumentControllerForActivity(controller);

  try {
    if (typeof controller.selectView !== 'function') {
      throw new Error('[Elo][Bases] controller.selectView is not a function (Bases internals changed)');
    }
    controller.selectView(viewName);

    const hasSetQueryAndView = typeof controller.setQueryAndView === 'function';

    if (!hasSetQueryAndView) {
      throw new Error('[Elo][Bases] No controller.setQueryAndView (Bases internals changed)');
    }

    state.armed = true;

    controller.setQueryAndView?.(controller.query, viewName);

    const deadline = nowMs() + timeoutMs;

    let activityObserved = false;
    let quietFrames = 0;

    // Also detect changes even if Bases swaps the results Map without calling patched methods.
    let lastResultsMap = getResultsMap(controller);
    let lastResultsSize = lastResultsMap ? lastResultsMap.size : 0;
    let lastActivityCount = state.activityCount;

    while (nowMs() < deadline) {
      await nextFrame();

      const curMap = getResultsMap(controller);
      const curSize = curMap ? curMap.size : 0;

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

function extractMarkdownFilesFromControllerResults(controller: BasesControllerLike): TFile[] {
  const results = getResultsMap(controller);
  if (!results) return [];

  const out: TFile[] = [];
  for (const k of results.keys()) {
    if (k instanceof TFile && k.extension.toLowerCase() === 'md') out.push(k);
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Resolve Markdown files from a .base file + view name by opening the Base,
 * running the query, waiting for results to settle, extracting `TFile`s,
 * then cleaning up.
 */
export async function resolveFilesFromBaseView(
  app: App,
  basePath: string,
  viewName: string,
  opts?: ResolveOpts,
): Promise<TFile[]> {
  const af = app.vault.getAbstractFileByPath(basePath);
  if (!(af instanceof TFile) || af.extension.toLowerCase() !== 'base') {
    throw new Error(`[Elo][Bases] Not a .base file: ${basePath}`);
  }
  const baseFile = af;

  const previousLeaf = getUserLeaf(app);

  let leaf: WorkspaceLeaf | null = null;

  try {
    const openedLeaf = await openBaseLeaf(app, baseFile, viewName);
    leaf = openedLeaf;

    const viewType = openedLeaf.view?.getViewType?.();
    if (viewType !== 'bases') {
      throw new Error(`[Elo][Bases] Unexpected view type: ${String(viewType)}`);
    }

    await nextFrame();

    const controller = getBasesControllerFromLeaf(openedLeaf);
    if (!controller) throw new Error('[Elo][Bases] Bases controller missing on view');

    await awaitControllerReady(
      controller,
      baseFile.path,
      viewName,
      opts?.readyTimeoutMs ?? READY_TIMEOUT_MS,
    );

    attempt(() => controller.updateCurrentFile?.());
    attempt(() => controller.onResize?.());

    await runQueryAndWaitForSettle(
      controller,
      viewName,
      opts?.runTimeoutMs ?? RUN_TIMEOUT_MS,
    );

    return extractMarkdownFilesFromControllerResults(controller);
  } finally {
    // Restore the user's previous leaf
    try {
      if (leaf && previousLeaf && previousLeaf !== leaf) {
        app.workspace.setActiveLeaf(previousLeaf, { focus: true });
        await nextFrame();
      }
    } catch {
      // ignore
    }

    try {
      leaf?.detach();
    } catch {
      // ignore
    }
  }
}
