import type { App, TFile } from 'obsidian';

import { ensureFolderExists } from '../../utils/ensureFolder';

const INVALID_CHARS = /[\\/:*?"<>|]/g;

function sanitizeFileName(name: string): string {
  return name.replace(INVALID_CHARS, '_').trim() || 'Session Report';
}

export async function writeSessionReport(
  app: App,
  markdown: string,
  folderPath: string,
  fileName: string,
): Promise<TFile> {
  const normalised = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
  await ensureFolderExists(app, normalised);

  const safeName = sanitizeFileName(fileName);
  const basePath = normalised.length > 0 ? `${normalised}/${safeName}` : safeName;

  // Handle name collisions
  let finalPath = `${basePath}.md`;
  let counter = 2;
  while (app.vault.getAbstractFileByPath(finalPath)) {
    finalPath = `${basePath} ${counter}.md`;
    counter++;
  }

  return await app.vault.create(finalPath, markdown);
}
