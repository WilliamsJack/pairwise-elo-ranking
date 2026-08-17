import type { WorkspaceLeaf } from 'obsidian';
import { MarkdownView } from 'obsidian';

import type { ScrollStartMode } from '../types';

export function getPreviewEl(view: MarkdownView): HTMLElement | null {
  const scope = view.contentEl ?? view.containerEl;
  return (
    scope.querySelector('.markdown-reading-view .markdown-preview-view') ??
    scope.querySelector('.markdown-preview-view')
  );
}

function getRenderedRoot(preview: HTMLElement): HTMLElement {
  return (
    preview.querySelector('.markdown-preview-sizer') ??
    preview.querySelector('.markdown-rendered') ??
    preview
  );
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

function findHeading(preview: HTMLElement): HTMLElement | null {
  return getRenderedRoot(preview).querySelector(HEADING_SELECTOR);
}

function findImage(preview: HTMLElement): HTMLElement | null {
  return getRenderedRoot(preview).querySelector('img');
}

/** Breathing room between the mobile chrome and the element we scrolled to. */
const CHROME_GAP_PX = 8;

/**
 * How far floating chrome reaches down into the pane (mobile).
 */
function getTopChromeInset(view: MarkdownView, previewTop: number): number {
  const header = view.containerEl.querySelector('.view-header');
  if (!(header instanceof HTMLElement)) return 0;

  if (header.win.getComputedStyle(header).position !== 'fixed') return 0;

  const overlap = header.offsetTop + header.offsetHeight - previewTop;

  return overlap > 0 ? overlap + CHROME_GAP_PX : 0;
}

/** One pane, for as long as it stays the one being scrolled. */
interface ScrollCtx {
  readonly preview: HTMLElement;

  /** Whether the pane has since moved on to another note. Polled between retries. */
  isStale: () => boolean;

  /** Scroll `target` to the top of the pane, stopping short of any chrome. */
  reveal: (target: Element) => void;
}

function createScrollCtx(
  view: MarkdownView,
  preview: HTMLElement,
  isStale: () => boolean,
): ScrollCtx {
  return {
    preview,
    isStale,
    reveal(target) {
      const previewTop = preview.getBoundingClientRect().top;
      const offset = target.getBoundingClientRect().top - previewTop;
      preview.scrollTop += offset - getTopChromeInset(view, previewTop);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Polls until `predicate` holds, reporting if it did. */
async function retryUntil(
  ctx: ScrollCtx,
  predicate: () => boolean,
  maxTries: number,
  stepMs: number,
): Promise<boolean> {
  for (let i = 0; i < maxTries; i++) {
    if (ctx.isStale()) return false;
    if (predicate()) return true;
    await sleep(stepMs);
  }
  return false;
}

async function scrollToFirstImage(ctx: ScrollCtx): Promise<void> {
  const { preview } = ctx;

  preview.scrollTop = 0;

  const revealImage = (): boolean => {
    const img = findImage(preview);
    if (!img) return false;
    ctx.reveal(img);
    return true;
  };

  // Phase 1: normal short retry (lets the initial viewport render)
  if (await retryUntil(ctx, revealImage, 5, 50)) return;

  // Phase 2: progressive scroll to force render in long lazily rendered notes
  const stepPx = Math.max(200, Math.floor(preview.clientHeight * 0.8));
  const maxSteps = 250;
  let stalled = 0;

  for (let i = 0; i < maxSteps; i++) {
    if (ctx.isStale()) return;
    if (revealImage()) return;

    const maxTop = Math.max(0, preview.scrollHeight - preview.clientHeight);
    const atBottom = preview.scrollTop >= maxTop - 2;

    if (atBottom) {
      // Give Obsidian a moment in case scrollHeight is still expanding as it renders
      await sleep(100);
      const newMaxTop = Math.max(0, preview.scrollHeight - preview.clientHeight);
      const stillAtBottom = preview.scrollTop >= newMaxTop - 2;
      if (stillAtBottom) break;
      continue;
    }

    const nextTop = Math.min(preview.scrollTop + stepPx, maxTop);

    // If we cannot make progress, wait a bit and then give up after a few stalls
    if (nextTop <= preview.scrollTop + 1) {
      stalled++;
      if (stalled >= 5) break;
      await sleep(50);
      continue;
    }

    stalled = 0;
    preview.scrollTop = nextTop;
    await sleep(50);
  }

  // Phase 3: fall back to heading
  if (ctx.isStale()) return;
  preview.scrollTop = 0;
  await sleep(0);

  const heading = findHeading(preview);
  if (heading) {
    ctx.reveal(heading);
  }
}

async function scrollToFirstHeading(ctx: ScrollCtx): Promise<void> {
  await retryUntil(
    ctx,
    () => {
      const heading = findHeading(ctx.preview);
      if (!heading) return false;
      ctx.reveal(heading);
      return true;
    },
    30,
    100,
  );
}

async function scrollAfterFrontmatter(ctx: ScrollCtx): Promise<void> {
  await retryUntil(
    ctx,
    () => {
      const root = getRenderedRoot(ctx.preview);

      // Scroll to the first real content element after the properties/frontmatter block
      let next = root.querySelector(
        ':scope > :has(.metadata-container, .frontmatter-container, .frontmatter, pre.frontmatter) ~ *',
      );

      while (next && next.scrollHeight <= 0) {
        next = next.nextElementSibling;
      }

      if (next) {
        ctx.reveal(next);
        return true;
      }
      return false;
    },
    30,
    100,
  );
}

export async function applyInitialScroll(
  leaf: WorkspaceLeaf,
  mode: ScrollStartMode,
  isStale: () => boolean,
): Promise<void> {
  if (mode === 'none') return;

  const view = leaf.view;
  if (!(view instanceof MarkdownView)) return;

  const preview = getPreviewEl(view);
  if (!preview) return;

  const ctx = createScrollCtx(view, preview, isStale);
  if (!(await retryUntil(ctx, () => ctx.preview.clientHeight > 0, 20, 50))) return;

  switch (mode) {
    case 'first-image':
      await scrollToFirstImage(ctx);
      break;
    case 'first-heading':
      await scrollToFirstHeading(ctx);
      break;
    case 'after-frontmatter':
      await scrollAfterFrontmatter(ctx);
      break;
  }
}
