import { App, Notice, TFolder } from 'obsidian';

import { CohortDefinition } from '../types';
import { PluginDataStore } from '../storage/PluginDataStore';
import { ResolveMissingFolderModal } from '../ui/ResolveMissingFolderModal';
import { makeCohortKey } from '../domain/cohort/CohortResolver';

export async function ensureFolderCohortPath(
  app: App,
  dataStore: PluginDataStore,
  def: CohortDefinition
): Promise<CohortDefinition | undefined> {
  if (def.kind !== 'folder' && def.kind !== 'folder-recursive') return def;

  const path: string = def.params?.path ?? '';
  const af = app.vault.getAbstractFileByPath(path);
  if (af instanceof TFolder) return def;

  // Collect Elo IDs from stored cohort (if any) for suggestions.
  const cohort = dataStore.store.cohorts[def.key];
  const idSet = new Set<string>(cohort ? Object.keys(cohort.players ?? {}) : []);

  const picked = await new ResolveMissingFolderModal(app, {
    oldPath: path,
    recursive: def.kind === 'folder-recursive',
    cohortIds: idSet,
  }).openAndGetFolderPath();

  if (!picked) {
    new Notice('Folder not found. Cancelled.');
    return undefined;
  }

  const newKey = makeCohortKey(def.kind, { path: picked });
  const newDef: CohortDefinition = {
    ...def,
    key: newKey,
    params: { path: picked },
    updatedAt: Date.now(),
  };

  dataStore.renameCohortKey(def.key, newDef);
  await dataStore.saveStore();
  return newDef;
}
