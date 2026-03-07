import type { App } from 'obsidian';
import { TFile } from 'obsidian';

import { ConfirmModal } from '../../ui/ConfirmModal';
import { ensureFolderExists } from '../../utils/ensureFolder';
import { DEFAULT_REPORT_TEMPLATE, PLACEHOLDER_DOCS } from './defaultReportTemplate';

function buildTemplateContent(): string {
  return PLACEHOLDER_DOCS + DEFAULT_REPORT_TEMPLATE + '\n';
}

async function ensureParentFolder(app: App, filePath: string): Promise<void> {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash <= 0) return;
  await ensureFolderExists(app, filePath.substring(0, lastSlash));
}

export async function generateExampleTemplate(
  app: App,
  opts: { filePath?: string; templatesFolderPath: string },
): Promise<{ file: TFile; overwritten: boolean } | 'exists'> {
  const filePath = (opts.filePath ?? '').trim();

  if (filePath.length > 0) {
    // Targeted path mode
    const existing = app.vault.getAbstractFileByPath(filePath);
    if (existing) return 'exists';

    await ensureParentFolder(app, filePath);
    const file = await app.vault.create(filePath, buildTemplateContent());
    return { file, overwritten: false };
  }

  // No path - default name in templatesFolderPath with collision counter
  const folder = (opts.templatesFolderPath || 'Glicko Reports')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');

  if (folder.length > 0) {
    await ensureParentFolder(app, `${folder}/placeholder`);
  }

  const baseName = 'Glicko Session Report Template';
  const basePath = folder.length > 0 ? `${folder}/${baseName}` : baseName;

  let finalPath = `${basePath}.md`;
  let counter = 2;
  while (app.vault.getAbstractFileByPath(finalPath)) {
    finalPath = `${basePath} ${counter}.md`;
    counter++;
  }

  const file = await app.vault.create(finalPath, buildTemplateContent());
  return { file, overwritten: false };
}

async function overwriteExampleTemplate(app: App, filePath: string): Promise<TFile> {
  const existing = app.vault.getAbstractFileByPath(filePath);
  if (!existing) {
    await ensureParentFolder(app, filePath);
    return await app.vault.create(filePath, buildTemplateContent());
  }
  if (!(existing instanceof TFile)) {
    throw new Error(`Expected a file but found a folder at "${filePath}"`);
  }
  await app.vault.modify(existing, buildTemplateContent());
  return existing;
}

/**
 * Generate-or-overwrite flow used by both the settings tab button and the
 * command palette command. Returns the created/overwritten file, or
 * `undefined` if the user cancelled.
 */
export async function generateOrOverwriteExampleTemplate(
  app: App,
  opts: {
    filePath?: string;
    templatesFolderPath: string;
  },
): Promise<TFile | undefined> {
  const filePath = (opts.filePath ?? '').trim();
  const result = await generateExampleTemplate(app, {
    filePath,
    templatesFolderPath: opts.templatesFolderPath,
  });

  if (result === 'exists') {
    const ok = await new ConfirmModal(
      app,
      'Overwrite template?',
      `The file "${filePath}" already exists. Overwrite it with a fresh example template?`,
      'Overwrite',
      'Cancel',
    ).openAndConfirm();
    if (!ok) return undefined;
    return await overwriteExampleTemplate(app, filePath);
  }

  return result.file;
}
