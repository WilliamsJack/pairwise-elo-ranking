import type { App} from 'obsidian';
import { Notice, TFile } from 'obsidian';

import { readBaseViews } from '../domain/bases/BasesDiscovery';
import { makeCohortKey } from '../domain/cohort/CohortResolver';
import type { PluginDataStore } from '../storage/PluginDataStore';
import type { CohortDefinition } from '../types';
import { ResolveMissingBaseModal } from '../ui/ResolveMissingBaseModal';

function getBaseFile(app: App, basePath: string): TFile | undefined {
  const af = app.vault.getAbstractFileByPath(basePath);
  if (af instanceof TFile && af.extension.toLowerCase() === 'base') return af;
  return undefined;
}

export async function ensureBaseCohortTarget(
  app: App,
  dataStore: PluginDataStore,
  def: CohortDefinition,
): Promise<CohortDefinition | undefined> {
  if (def.kind !== 'base') return def;

  const basePath = String(def.params?.baseId ?? '');
  const view = String(def.params?.view ?? '');

  const baseFile = getBaseFile(app, basePath);

  let viewOk = false;
  if (baseFile) {
    const views = await readBaseViews(app, baseFile);
    viewOk = views.some((v) => v.name === view);
  }

  if (baseFile && viewOk) return def;

  const picked = await new ResolveMissingBaseModal(app, {
    oldBasePath: basePath,
    oldView: view,
  }).openAndGetSelection();

  if (!picked) {
    new Notice('Base/view not found. Cancelled.');
    return undefined;
  }

  const newKey = makeCohortKey({
    kind: 'base',
    params: { baseId: picked.basePath, view: picked.view },
  });

  const newDef: CohortDefinition = {
    ...def,
    key: newKey,
    params: { baseId: picked.basePath, view: picked.view },
    updatedAt: Date.now(),
  };

  dataStore.renameCohortKey(def.key, newDef);
  await dataStore.saveStore();
  return newDef;
}
