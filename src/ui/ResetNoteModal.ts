import type { App } from 'obsidian';

import { parseCohortKey, prettyCohortDefinition } from '../domain/cohort/CohortResolver';
import type { PluginDataStore } from '../storage/PluginDataStore';
import { BasePromiseFuzzyModal } from './PromiseModal';

export const ALL_SENTINEL = '__all__';

export class ResetNoteModal extends BasePromiseFuzzyModal<string> {
  private cohortKeys: string[];
  private dataStore: PluginDataStore;

  constructor(app: App, dataStore: PluginDataStore, cohortKeys: string[]) {
    super(app);
    this.dataStore = dataStore;
    this.cohortKeys = cohortKeys;
    this.setPlaceholder('Choose a cohort to reset rating in...');
  }

  getItems(): string[] {
    return [ALL_SENTINEL, ...this.cohortKeys];
  }

  getItemText(item: string): string {
    if (item === ALL_SENTINEL) return 'All cohorts';
    const def = this.dataStore.getCohortDef(item) ?? parseCohortKey(item);
    if (!def) return item;
    return def.label ?? prettyCohortDefinition(def);
  }
}
