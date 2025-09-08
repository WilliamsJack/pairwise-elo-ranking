import { App, TFile } from 'obsidian';

// Matches HTML comments like: <!-- eloId: 123e4567-e89b-12d3-a456-426614174000 -->
const ELO_ID_COMMENT_BASE = /<!--\s*eloId\s*:\s*([0-9A-Za-z][0-9A-Za-z._-]*)\s*-->/;

function extractEloIdFromHtmlComment(text: string): string | undefined {
  const m = ELO_ID_COMMENT_BASE.exec(text);
  return m ? m[1] : undefined;
}

export async function getEloId(app: App, file: TFile): Promise<string | undefined> {
  // Prefer frontmatter
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  const id = fm?.eloId;
  if (typeof id === 'string' && id.length > 0) return id;

  // Fallback: look for an HTML comment marker anywhere in the note
  try {
    const text = await app.vault.cachedRead(file);
    return extractEloIdFromHtmlComment(text);
  } catch {
    return undefined;
  }
}

export async function ensureEloId(
  app: App,
  file: TFile,
  preferredLocation: 'frontmatter' | 'end' = 'frontmatter'
): Promise<string> {
  const existing = await getEloId(app, file);
  if (existing) return existing;

  const id = (window.crypto && 'randomUUID' in window.crypto)
    ? window.crypto.randomUUID()
    : fallbackUUID();

  if (preferredLocation === 'end') {
    await app.vault.process(file, (data) => {
      if (extractEloIdFromHtmlComment(data)) return data;
      const needsNewline = data.length > 0 && !data.endsWith('\n');
      const marker = `<!-- eloId: ${id} -->`;
      return data + (needsNewline ? '\n' : '') + '\n' + marker + '\n';
    });
    return id;
  }
}

function fallbackUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
