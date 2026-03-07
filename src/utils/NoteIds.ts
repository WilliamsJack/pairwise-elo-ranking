import type { App, TFile } from 'obsidian';

import { debugWarn } from './logger';

// Matches HTML comments like: <!-- eloId: 123e4567-e89b-12d3-a456-426614174000 -->
function buildIdHtmlCommentRegex(propName: string): RegExp {
  const escaped = propName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<!--\\s*${escaped}\\s*:\\s*([0-9A-Za-z][0-9A-Za-z._-]*)\\s*-->`, 'g');
}

export function extractIdFromHtmlComment(text: string, propertyName: string): string | undefined {
  let last: string | undefined;
  for (const m of text.matchAll(buildIdHtmlCommentRegex(propertyName))) {
    last = m[1];
  }
  return last;
}

export function getNoteIdFromFrontmatterCache(
  app: App,
  file: TFile,
  propertyName: string,
): string | undefined {
  const fmRaw: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
  const fm = fmRaw && typeof fmRaw === 'object' ? (fmRaw as Record<string, unknown>) : undefined;
  const fmId = fm ? fm[propertyName] : undefined;
  return typeof fmId === 'string' && fmId.length > 0 ? fmId : undefined;
}

export async function getNoteIdFromHtmlComment(
  app: App,
  file: TFile,
  propertyName: string,
): Promise<string | undefined> {
  try {
    const text = await app.vault.cachedRead(file);
    return extractIdFromHtmlComment(text, propertyName);
  } catch (e) {
    debugWarn(`Failed to read HTML comment ${propertyName} from ${file.path}`, e);
    return undefined;
  }
}

export async function setNoteIdInFrontmatter(
  app: App,
  file: TFile,
  id: string,
  propertyName: string,
): Promise<void> {
  const cur = getNoteIdFromFrontmatterCache(app, file, propertyName);
  if (cur === id) return;

  await app.fileManager.processFrontMatter(file, (fmRaw) => {
    const fm = fmRaw as Record<string, unknown>;
    fm[propertyName] = id;
  });
}

export async function removeNoteIdFromFrontmatter(
  app: App,
  file: TFile,
  propertyName: string,
): Promise<boolean> {
  const cur = getNoteIdFromFrontmatterCache(app, file, propertyName);
  if (!cur) return false;

  await app.fileManager.processFrontMatter(file, (fmRaw) => {
    const fm = fmRaw as Record<string, unknown>;
    delete fm[propertyName];
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

function getLastIdHtmlCommentMatch(
  text: string,
  propertyName: string,
): RegExpMatchArray | undefined {
  let last: RegExpMatchArray | undefined;
  for (const m of text.matchAll(buildIdHtmlCommentRegex(propertyName))) last = m;
  return last;
}

function appendIdHtmlCommentAtEnd(text: string, id: string, propertyName: string): string {
  const eol = detectEol(text);
  const marker = `<!-- ${propertyName}: ${id} -->`;

  let out = text;

  // Ensure the marker begins on a new line
  if (!out.endsWith('\n')) out += eol;

  // Ensure there is an empty line above the marker (add at most one)
  if (!endsWithBlankLine(out)) out += eol;

  // Marker always ends with a trailing newline
  return out + marker + eol;
}

function removeTrailingIdHtmlComments(
  text: string,
  propertyName: string,
  ensureTrailingNewline: boolean,
): { text: string; removed: boolean } {
  const eol = detectEol(text);
  let out = text;
  let removedAny = false;
  let removedBlankLineAbove = false;

  while (true) {
    const m = getLastIdHtmlCommentMatch(out, propertyName);
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

function removeAllIdHtmlCommentsPreservingWhitespace(
  text: string,
  propertyName: string,
  ensureTrailingNewlineIfTrailingRemoved: boolean,
): { text: string; changed: boolean } {
  let changed = false;

  const trailing = removeTrailingIdHtmlComments(
    text,
    propertyName,
    ensureTrailingNewlineIfTrailingRemoved,
  );
  changed ||= trailing.removed;

  // Then remove any remaining markers elsewhere - remove just the comment text
  const out = trailing.text.replace(buildIdHtmlCommentRegex(propertyName), () => {
    changed = true;
    return '';
  });

  return { text: out, changed };
}

/**
 * Append an ID marker at the end of the note.
 *
 * If an ID marker already exists with a different ID, return the note unchanged.
 */
export async function setNoteIdInHtmlComment(
  app: App,
  file: TFile,
  id: string,
  propertyName: string,
): Promise<void> {
  await app.vault.process(file, (data) => {
    const existing = extractIdFromHtmlComment(data, propertyName);
    if (existing === id) return data;

    // If there is already a different note ID HTML comment, do not overwrite here
    if (existing && existing !== id) return data;

    return appendIdHtmlCommentAtEnd(data, id, propertyName);
  });
}

export async function overwriteNoteIdInHtmlComment(
  app: App,
  file: TFile,
  id: string,
  propertyName: string,
): Promise<void> {
  await app.vault.process(file, (data) => {
    const regex = buildIdHtmlCommentRegex(propertyName);
    const matches = Array.from(data.matchAll(regex));

    if (matches.length === 1 && matches[0][1] === id) {
      const m = matches[0];
      const start = typeof m.index === 'number' ? m.index : -1;
      if (start >= 0) {
        const end = start + m[0].length;
        const after = data.slice(end);
        if (/^[ \t]*(?:\r?\n)*$/.test(after)) return data;
      }
    }

    const removed = removeAllIdHtmlCommentsPreservingWhitespace(data, propertyName, false);

    return appendIdHtmlCommentAtEnd(removed.text, id, propertyName);
  });
}

export async function removeNoteIdHtmlComments(
  app: App,
  file: TFile,
  propertyName: string,
): Promise<boolean> {
  let changed = false;

  await app.vault.process(file, (data) => {
    const removed = removeAllIdHtmlCommentsPreservingWhitespace(data, propertyName, true);

    if (!removed.changed) return data;

    changed = true;
    return removed.text;
  });

  return changed;
}

export async function removeNoteIdEverywhere(
  app: App,
  file: TFile,
  propertyName: string,
): Promise<boolean> {
  const removedFrontmatter = await removeNoteIdFromFrontmatter(app, file, propertyName);
  const removedHtml = await removeNoteIdHtmlComments(app, file, propertyName);
  return removedFrontmatter || removedHtml;
}

export async function getNoteId(
  app: App,
  file: TFile,
  propertyName: string,
): Promise<string | undefined> {
  const fmId = getNoteIdFromFrontmatterCache(app, file, propertyName);
  if (fmId) return fmId;

  return await getNoteIdFromHtmlComment(app, file, propertyName);
}

export async function ensureNoteId(
  app: App,
  file: TFile,
  preferredLocation: 'frontmatter' | 'end' = 'frontmatter',
  propertyName: string,
): Promise<string> {
  const existing = await getNoteId(app, file, propertyName);
  if (existing) return existing;

  const id = crypto.randomUUID();

  if (preferredLocation === 'end') {
    await setNoteIdInHtmlComment(app, file, id, propertyName);
  } else {
    await setNoteIdInFrontmatter(app, file, id, propertyName);
  }

  return id;
}
