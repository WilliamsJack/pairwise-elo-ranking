import type { App } from 'obsidian';

/**
 * Ensure a folder path exists in the vault, creating intermediate
 * directories as needed. A no-op if the path is empty.
 */
export async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
  const normalised = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalised.length === 0) return;

  const segments = normalised.split('/');
  let current = '';
  for (const seg of segments) {
    current = current ? `${current}/${seg}` : seg;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}
