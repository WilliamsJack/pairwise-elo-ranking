import type { App, TFile } from 'obsidian';

// Matches HTML comments like: <!-- eloId: 123e4567-e89b-12d3-a456-426614174000 -->
const ELO_ID_HTML_COMMENT_BASE = /<!--\s*eloId\s*:\s*([0-9A-Za-z][0-9A-Za-z._-]*)\s*-->/;

function eloIdHtmlCommentGlobal(): RegExp {
  return new RegExp(ELO_ID_HTML_COMMENT_BASE.source, 'g');
}

export function extractEloIdFromHtmlComment(text: string): string | undefined {
  let last: string | undefined;
  // Returns *last* match, the real marker is typically appended at the end of the note
  for (const m of text.matchAll(eloIdHtmlCommentGlobal())) {
    last = m[1];
  }
  return last;
}

export function getEloIdFromFrontmatterCache(app: App, file: TFile): string | undefined {
  const fmRaw: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
  const fm = fmRaw && typeof fmRaw === 'object' ? (fmRaw as Record<string, unknown>) : undefined;
  const fmId = fm ? fm['eloId'] : undefined;
  return typeof fmId === 'string' && fmId.length > 0 ? fmId : undefined;
}

export async function getEloIdFromHtmlComment(app: App, file: TFile): Promise<string | undefined> {
  try {
    const text = await app.vault.cachedRead(file);
    return extractEloIdFromHtmlComment(text);
  } catch {
    return undefined;
  }
}

export async function setEloIdInFrontmatter(app: App, file: TFile, id: string): Promise<void> {
  const cur = getEloIdFromFrontmatterCache(app, file);
  if (cur === id) return;

  await app.fileManager.processFrontMatter(file, (fmRaw) => {
    const fm = fmRaw as Record<string, unknown>;
    fm['eloId'] = id;
  });
}

export async function removeEloIdFromFrontmatter(app: App, file: TFile): Promise<boolean> {
  const cur = getEloIdFromFrontmatterCache(app, file);
  if (!cur) return false;

  await app.fileManager.processFrontMatter(file, (fmRaw) => {
    const fm = fmRaw as Record<string, unknown>;
    delete fm['eloId'];
  });

  return true;
}

function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function stripOneLeadingLineBreak(text: string): string {
  if (text.startsWith('\r\n')) return text.slice(2);
  if (text.startsWith('\n')) return text.slice(1);
  return text;
}

function stripOneTrailingLineBreak(text: string): string {
  if (text.endsWith('\r\n')) return text.slice(0, -2);
  if (text.endsWith('\n')) return text.slice(0, -1);
  return text;
}

function endsWithBlankLine(text: string): boolean {
  return /(?:\r?\n){2}$/.test(text);
}

function getLastEloIdHtmlCommentMatch(text: string): RegExpMatchArray | undefined {
  let last: RegExpMatchArray | undefined;
  for (const m of text.matchAll(eloIdHtmlCommentGlobal())) last = m;
  return last;
}

function appendEloIdHtmlCommentAtEnd(text: string, id: string): string {
  const eol = detectEol(text);
  const marker = `<!-- eloId: ${id} -->`;

  let out = text;

  // Ensure the marker begins on a new line
  if (!out.endsWith('\n')) out += eol;

  // Ensure there is an empty line above the marker (add at most one)
  if (!endsWithBlankLine(out)) out += eol;

  // Marker always ends with a trailing newline
  return out + marker + eol;
}

function removeTrailingEloIdHtmlComments(
  text: string,
  ensureTrailingNewline: boolean,
): { text: string; removed: boolean } {
  const eol = detectEol(text);
  let out = text;
  let removedAny = false;
  let removedBlankLineAbove = false;

  while (true) {
    const m = getLastEloIdHtmlCommentMatch(out);
    if (!m || typeof m.index !== 'number') break;

    const start = m.index;
    const end = start + m[0].length;
    const after = out.slice(end);

    // Only treat it as a trailing marker if *only line breaks* follow it
    // (Any other whitespace is treated as user content and left alone)
    if (!/^(?:\r?\n)*$/.test(after)) break;

    removedAny = true;

    let before = out.slice(0, start);
    let rest = after;

    // Remove the marker's own line break if present
    rest = stripOneLeadingLineBreak(rest);

    // Remove at most one completely empty line immediately above the marker block
    if (!removedBlankLineAbove && /(?:\r?\n){2}$/.test(before)) {
      before = stripOneTrailingLineBreak(before);
      removedBlankLineAbove = true;
    }

    out = before + rest;
  }

  if (removedAny && ensureTrailingNewline) {
    // Ensure at least one trailing newline remains
    if (out.length === 0) return { text: eol, removed: true };
    if (!out.endsWith('\n')) return { text: out + eol, removed: true };
  }

  return { text: out, removed: removedAny };
}

function removeAllEloIdHtmlCommentsPreservingWhitespace(
  text: string,
  ensureTrailingNewlineIfTrailingRemoved: boolean,
): { text: string; changed: boolean } {
  let changed = false;

  // First, remove any trailing marker block in the EOF-specific way
  const trailing = removeTrailingEloIdHtmlComments(text, ensureTrailingNewlineIfTrailingRemoved);
  changed ||= trailing.removed;

  // Then remove any remaining markers elsewhere - remove just the comment text
  const out = trailing.text.replace(eloIdHtmlCommentGlobal(), () => {
    changed = true;
    return '';
  });

  return { text: out, changed };
}

/**
 * Append an eloId marker at the end of the note.
 *
 * If an eloId marker already exists with a different ID, return the note unchanged.
 */
export async function setEloIdInHtmlComment(app: App, file: TFile, id: string): Promise<void> {
  await app.vault.process(file, (data) => {
    const existing = extractEloIdFromHtmlComment(data);
    if (existing === id) return data;

    // If there is already a different eloId HTML comment, do not overwrite here
    if (existing && existing !== id) return data;

    return appendEloIdHtmlCommentAtEnd(data, id);
  });
}

export async function overwriteEloIdInHtmlComment(
  app: App,
  file: TFile,
  id: string,
): Promise<void> {
  await app.vault.process(file, (data) => {
    const matches = Array.from(data.matchAll(eloIdHtmlCommentGlobal()));

    // If there is exactly one marker with the desired id, and only whitespace follows it, return unchanged
    if (matches.length === 1 && matches[0][1] === id) {
      const m = matches[0];
      const start = typeof m.index === 'number' ? m.index : -1;
      if (start >= 0) {
        const end = start + m[0].length;
        const after = data.slice(end);
        if (/^[ \t]*(?:\r?\n)*$/.test(after)) return data;
      }
    }

    // Remove existing markers with minimal changes, then append the desired marker at EOF
    const removed = removeAllEloIdHtmlCommentsPreservingWhitespace(
      data,
      false, // newline will be added by append function
    );

    return appendEloIdHtmlCommentAtEnd(removed.text, id);
  });
}

export async function removeEloIdHtmlComments(app: App, file: TFile): Promise<boolean> {
  let changed = false;

  await app.vault.process(file, (data) => {
    const removed = removeAllEloIdHtmlCommentsPreservingWhitespace(
      data,
      true, // if we removed a trailing marker, ensure at least one trailing newline remains
    );

    if (!removed.changed) return data;

    changed = true;
    return removed.text;
  });

  return changed;
}

export async function removeEloIdEverywhere(app: App, file: TFile): Promise<boolean> {
  const removedFrontmatter = await removeEloIdFromFrontmatter(app, file);
  const removedHtml = await removeEloIdHtmlComments(app, file);
  return removedFrontmatter || removedHtml;
}

export async function getEloId(app: App, file: TFile): Promise<string | undefined> {
  // Prefer frontmatter
  const fmId = getEloIdFromFrontmatterCache(app, file);
  if (fmId) return fmId;

  // Fallback: look for an HTML comment marker anywhere in the note
  return await getEloIdFromHtmlComment(app, file);
}

export async function ensureEloId(
  app: App,
  file: TFile,
  preferredLocation: 'frontmatter' | 'end' = 'frontmatter',
): Promise<string> {
  const existing = await getEloId(app, file);
  if (existing) return existing;

  const id = crypto.randomUUID();

  if (preferredLocation === 'end') {
    await setEloIdInHtmlComment(app, file, id);
  } else {
    await setEloIdInFrontmatter(app, file, id);
  }

  return id;
}
