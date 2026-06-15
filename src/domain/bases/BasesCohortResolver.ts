import type { App, Component } from 'obsidian';
import { TFile } from 'obsidian';

import { debugWarn } from '../../utils/logger';

const TIMEOUT_MS = 5_000;
const DEFAULT_POLL_MS = 50;

type ResolveOpts = {
  timeoutMs?: number;
  pollMs?: number;
};

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

// ---- Minimal models of Bases internals ----

type BasesControllerLike = {
  results?: unknown;
  initialScan?: unknown;
  currentFile?: unknown;
};

type BasesEmbedLike = Component & {
  controller?: BasesControllerLike;
  containingFile?: unknown;
  loadFile: () => Promise<void>;
};

type EmbedInfo = { app: App; containerEl: HTMLElement };

// `app.embedRegistry.embedByExtension['base']` is an undocumented internal API.
type AppWithEmbedRegistry = App & {
  embedRegistry?: {
    embedByExtension?: {
      base?: (info: EmbedInfo, file: TFile, subpath: string) => BasesEmbedLike;
    };
  };
};

// ---- Results extraction ----

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
  const started = performance.now();
  const deadline = started + timeoutMs;

  while (true) {
    const resultsOk = isResultsLike(controller.results);
    const scan = controller.initialScan;
    const scanOk = typeof scan === 'boolean';

    if (resultsOk && scanOk && scan === false) return { settled: true };

    if (performance.now() >= deadline) {
      if (resultsOk) return { settled: false };
      throw new Error('[Glicko][Bases] Timed out waiting for Bases results container');
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
 * Load a .base file + view into a hidden embed.
 */
function createHiddenBaseEmbed(
  app: App,
  containerEl: HTMLElement,
  baseFile: TFile,
  viewName: string,
): BasesEmbedLike {
  const embedFactory = (app as AppWithEmbedRegistry).embedRegistry?.embedByExtension?.base;
  if (typeof embedFactory !== 'function') {
    throw new Error('[Glicko][Bases] Bases embed registry is unavailable');
  }

  const embed = embedFactory({ app, containerEl }, baseFile, viewName);

  embed.containingFile = baseFile;
  if (embed.controller) embed.controller.currentFile = baseFile;

  return embed;
}

/**
 * Resolve Markdown files from a .base file + view name by loading the Base into a hidden
 * embed, waiting for results to settle, extracting TFiles, then tearing the embed down.
 */
export async function resolveFilesFromBaseView(
  app: App,
  basePath: string,
  viewName: string,
  opts?: ResolveOpts,
): Promise<TFile[]> {
  const af = app.vault.getAbstractFileByPath(basePath);
  if (!(af instanceof TFile) || af.extension.toLowerCase() !== 'base') {
    throw new Error(`[Glicko][Bases] Not a .base file: ${basePath}`);
  }
  const baseFile = af;

  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_MS;

  const containerEl = app.workspace.containerEl.createDiv({
    cls: 'glicko-offscreen',
    attr: { 'aria-hidden': 'true' },
  });
  let embed: BasesEmbedLike | null = null;

  try {
    embed = createHiddenBaseEmbed(app, containerEl, baseFile, viewName);
    embed.load();
    await embed.loadFile();

    const controller = embed.controller;
    if (!controller) {
      throw new Error('[Glicko][Bases] Bases controller unavailable after loadFile');
    }

    await waitForResultsToSettle(controller, timeoutMs, pollMs);

    return extractMarkdownFilesFromControllerResults(controller);
  } finally {
    try {
      embed?.unload();
    } catch (e) {
      debugWarn('Bases resolver: failed to unload hidden base embed', e);
    }

    try {
      containerEl.remove();
    } catch (e) {
      debugWarn('Bases resolver: failed to remove hidden container', e);
    }
  }
}
