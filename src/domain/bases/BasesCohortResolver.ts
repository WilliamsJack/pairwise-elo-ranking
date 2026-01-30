import type { App, OpenViewState, WorkspaceLeaf } from 'obsidian';
import { TFile } from 'obsidian';

const TIMEOUT_MS = 5_000;

const DEFAULT_POLL_MS = 50;

type ResolveOpts = {
  timeoutMs?: number;
  pollMs?: number;
};

function nowMs(): number {
  return window.performance?.now?.() ?? Date.now();
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, Math.round(ms))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

type ResultsLike = {
  size: number;
  keys: () => IterableIterator<unknown>;
};

function isResultsLike(value: unknown): value is ResultsLike {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ResultsLike).size === 'number' &&
    typeof (value as ResultsLike).keys === 'function'
  );
}

// Minimal model of Bases controller internals
type BasesControllerLike = {
  currentFile?: unknown;
  query?: unknown;
  queryState?: unknown;
  results?: unknown;

  // True while Bases is scanning/building results, false once done.
  initialScan?: unknown;

  getQueryViewNames?: () => unknown;
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

  // Make the target leaf active so openLinkText opens into it.
  app.workspace.setActiveLeaf(leaf, { focus: true });
  await nextFrame();

  const linktext = `${baseFile.path}#${viewName}`;
  const openState: OpenViewState = { active: true };

  await app.workspace.openLinkText(linktext, baseFile.path, false, openState);

  // Give Obsidian time to attach the view and controller.
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
  pollMs: number,
): Promise<void> {
  const started = nowMs();

  while (true) {
    const curFile = controller.currentFile;
    const curFileOk = curFile instanceof TFile && curFile.path === basePath;

    const hasQuery = typeof controller.query !== 'undefined';
    const hasQueryState =
      typeof controller.queryState === 'string' && controller.queryState.length > 0;
    const viewNameOk = controllerHasViewName(controller, viewName);

    if (curFileOk && hasQuery && hasQueryState && viewNameOk) return;

    if (nowMs() - started >= timeoutMs) break;
    await sleep(pollMs);
  }

  throw new Error('[Elo][Bases] Timed out waiting for Bases controller readiness');
}

/**
 * Wait for Bases to finish producing results.
 *
 * Completion condition:
 * - results container exists, and
 * - initialScan === false.
 *
 * On timeout:
 * - if results exist, return settled=false (best-effort),
 * - otherwise throw.
 */
async function waitForResultsToSettle(
  controller: BasesControllerLike,
  timeoutMs: number,
  pollMs: number,
): Promise<{ settled: boolean }> {
  const started = nowMs();
  const deadline = started + timeoutMs;

  while (true) {
    const resultsOk = isResultsLike(controller.results);
    const scan = controller.initialScan;
    const scanOk = typeof scan === 'boolean';

    if (resultsOk && scanOk && scan === false) return { settled: true };

    if (nowMs() >= deadline) {
      if (resultsOk) return { settled: false };
      throw new Error('[Elo][Bases] Timed out waiting for Bases results container');
    }

    await sleep(pollMs);
  }
}

function extractMarkdownFilesFromControllerResults(controller: BasesControllerLike): TFile[] {
  const resultsUnknown = controller.results;
  if (!isResultsLike(resultsUnknown)) return [];

  const out: TFile[] = [];
  for (const k of resultsUnknown.keys()) {
    if (k instanceof TFile && k.extension.toLowerCase() === 'md') out.push(k);
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Resolve Markdown files from a .base file + view name by opening the Base,
 * waiting for results to settle, extracting `TFile`s, then cleaning up.
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

  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_MS;

  const previousLeaf = getUserLeaf(app);
  let leaf: WorkspaceLeaf | null = null;

  try {
    leaf = await openBaseLeaf(app, baseFile, viewName);

    const viewType = leaf.view?.getViewType?.();
    if (viewType !== 'bases') {
      throw new Error(`[Elo][Bases] Unexpected view type: ${String(viewType)}`);
    }

    const controller = getBasesControllerFromLeaf(leaf);
    if (!controller) throw new Error('[Elo][Bases] Bases controller missing on view');

    await awaitControllerReady(controller, baseFile.path, viewName, timeoutMs, pollMs);

    await waitForResultsToSettle(controller, timeoutMs, pollMs);

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
