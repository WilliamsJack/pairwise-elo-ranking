import type { App, TFile } from 'obsidian';
import { Notice } from 'obsidian';

import { ResolveDuplicateEloIdsModal } from '../ui/ResolveDuplicateEloIdsModal';
import { getEloId } from './NoteIds';

const DEFAULT_POOL = 8;

export async function findDuplicateEloIds(
  app: App,
  files: TFile[],
  opts?: { pool?: number },
): Promise<Map<string, TFile[]>> {
  const pool = Math.max(1, Math.round(opts?.pool ?? DEFAULT_POOL));
  const byId = new Map<string, TFile[]>();

  let idx = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = idx++;
      if (i >= files.length) break;

      const f = files[i];
      const id = await getEloId(app, f);
      if (!id) continue;

      const existing = byId.get(id);
      if (existing) existing.push(f);
      else byId.set(id, [f]);
    }
  };

  await Promise.all(Array.from({ length: pool }, () => worker()));

  const dupes = new Map<string, TFile[]>();
  for (const [id, list] of byId.entries()) {
    if (list.length > 1) dupes.set(id, list);
  }

  return dupes;
}

/**
 * Ensures there are no duplicate Elo IDs across `files`.
 *
 * Returns:
 * - true: duplicates resolved (or none found), safe to start session
 * - false: user cancelled (session should not start)
 */
export async function ensureUniqueEloIds(app: App, files: TFile[]): Promise<boolean> {
  if (files.length < 2) return true;

  while (true) {
    const scanning = new Notice('Scanning notes for duplicate Elo IDs...', 0);

    let dupes: Map<string, TFile[]>;
    try {
      dupes = await findDuplicateEloIds(app, files);
    } finally {
      scanning?.hide?.();
    }

    if (dupes.size === 0) return true;

    // Handle one duplicate ID group at a time (stable order by ID)
    const ids = Array.from(dupes.keys()).sort((a, b) => a.localeCompare(b));
    const id = ids[0];
    const dupFiles = dupes.get(id) ?? [];

    const res = await new ResolveDuplicateEloIdsModal(app, {
      eloId: id,
      files: dupFiles,
    }).openAndGetResult();

    if (res === true) {
      // Loop and re-scan, because there may be more duplicates across the cohort
      continue;
    }

    // User cancelled: stop session start
    return false;
  }
}
