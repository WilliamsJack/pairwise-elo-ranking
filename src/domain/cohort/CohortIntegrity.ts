import { App, TFile } from 'obsidian';

import { PluginDataStore } from '../../storage/PluginDataStore';
import { getEloId } from '../../utils/NoteIds';

/**
 * Scan all notes in the cohort to collect Elo IDs (frontmatter or HTML comment),
 * then remove any players from the cohort whose IDs are not present.
 *
 * Returns the list of removed IDs.
 */
export async function reconcileCohortPlayersWithFiles(
  app: App,
  dataStore: PluginDataStore,
  cohortKey: string,
  files: TFile[],
): Promise<string[]> {
  const cohort = dataStore.store.cohorts[cohortKey];
  if (!cohort) return [];

  const foundIds = new Set<string>();
  await Promise.all(
    files.map(async (f) => {
      const id = await getEloId(app, f);
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
