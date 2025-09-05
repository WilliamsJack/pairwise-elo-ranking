import { App, TFile } from 'obsidian';

export function getEloId(app: App, file: TFile): string | undefined {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  const id = fm?.eloId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export async function ensureEloId(app: App, file: TFile): Promise<string> {
  const existing = getEloId(app, file);
  if (existing) return existing;

  const id = (window.crypto && 'randomUUID' in window.crypto)
    ? window.crypto.randomUUID()
    : fallbackUUID();

  await app.fileManager.processFrontMatter(file, (fm) => {
    if (!fm.eloId) fm.eloId = id;
  });
  return id;
}

function fallbackUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}