import type { App, TFile } from 'obsidian';

import type { PluginDataStore } from '../../storage/PluginDataStore';
import { getNoteId } from '../../utils/NoteIds';

/**
 * Scan all notes in the cohort to collect note IDs (frontmatter or HTML comment),
 * then remove any players from the cohort whose IDs are not present.
 *
 * Returns the list of removed IDs.
 */
export async function reconcileCohortPlayersWithFiles(
  app: App,
  dataStore: PluginDataStore,
  cohortKey: string,
  files: TFile[],
  idPropertyName: string,
): Promise<string[]> {
  const cohort = dataStore.store.cohorts[cohortKey];
  if (!cohort) return [];

  const foundIds = new Set<string>();
  await Promise.all(
    files.map(async (f) => {
      const id = await getNoteId(app, f, idPropertyName);
      if (id) foundIds.add(id);
    }),
  );

  const players = cohort.players ?? {};
  const removed: string[] = [];
  for (const id of Object.keys(players)) {
    if (!foundIds.has(id)) {
      delete players[id];
      removed.push(id);
    }
  }

  if (removed.length > 0) {
    await dataStore.saveStore();
  }

  return removed;
}
