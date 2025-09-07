import { EloSettings, effectiveFrontmatterProperties } from './settings/settings';
import { Notice, Plugin, TAbstractFile, TFile } from 'obsidian';
import { computeRankMap, updateCohortFrontmatter } from './utils/FrontmatterStats';

import ArenaSession from './ui/ArenaSession';
import { CohortDefinition } from './types';
import { CohortPicker } from './ui/CohortPicker';
import EloSettingsTab from './settings/SettingsTab';
import { PluginDataStore } from './storage/PluginDataStore';
import { ensureFolderCohortPath } from './utils/EnsureFolderCohort';
import { reconcileCohortPlayersWithFiles } from './domain/cohort/CohortIntegrity';
import { resolveFilesForCohort } from './domain/cohort/CohortResolver';

export default class EloPlugin extends Plugin {
  dataStore: PluginDataStore;
  settings: EloSettings;

  private currentSession?: ArenaSession;

  async onload() {
    this.dataStore = new PluginDataStore(this);
    await this.dataStore.load();
    this.settings = this.dataStore.settings;

    this.addRibbonIcon('trophy', 'Start Elo rating session', async () => {
      await this.selectCohortAndStart();
    });

    this.addCommand({
      id: 'elo-start-session',
      name: 'Start rating session',
      callback: async () => {
        await this.selectCohortAndStart();
      },
    });

    this.addCommand({
      id: 'elo-end-session',
      name: 'End current session',
      checkCallback: (checking) => {
        const has = !!this.currentSession;
        if (!checking && has) this.endSession();
        return has;
      },
    });

    this.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.currentSession?.onFileRenamed(oldPath, file);
        }
      }),
    );

    this.addSettingTab(new EloSettingsTab(this.app, this));
  }

  onunload(): void {
    this.endSession();
    void this.dataStore.saveAllImmediate?.();
  }

  async saveSettings() {
    await this.dataStore.saveSettings();
  }

  private async selectCohortAndStart() {
    const picker = new CohortPicker(this.app, this);
    let def = await picker.openAndGetSelection();
    if (!def) return;

    // Recover folder for folder-based cohorts if missing
    def = await ensureFolderCohortPath(this.app, this.dataStore, def);
    if (!def) return;

    const files = resolveFilesForCohort(this.app, def);
    if (files.length < 2) {
      new Notice('Need at least two Markdown notes to compare.');
      return;
    }

    if (!this.dataStore.getCohortDef(def.key)) {
      this.dataStore.upsertCohortDef(def);
      await this.dataStore.saveStore();
    }

    await this.startSessionForCohort(def, files, { saveDef: false });
  }

  private async startSessionForCohort(def: CohortDefinition, files: TFile[], _opts?: { saveDef?: boolean }) {
    this.endSession();

    this.currentSession = new ArenaSession(this.app, this, def.key, files);
    this.register(() => this.endSession());

    // Await the UI start so the currently displayed notes have IDs if needed
    await this.currentSession.start();

    this.dataStore.setLastUsedCohortKey(def.key);
    void this.dataStore.saveStore();

    // Run cohort integrity scan after start()
    void reconcileCohortPlayersWithFiles(this.app, this.dataStore, def.key, files).catch(() => {});
  }

  public endSession() {
    if (!this.currentSession) return;

    const session = this.currentSession;
    const cohortKey = session.getCohortKey();

    session.end();
    this.currentSession = undefined;

    // After session ends, update rank across the cohort if enabled
    const def = this.dataStore.getCohortDef(cohortKey);
    const cohort = this.dataStore.store.cohorts[cohortKey];
    if (!def || !cohort) return;

    const fm = effectiveFrontmatterProperties(
      this.settings.frontmatterProperties,
      def.frontmatterOverrides,
    );
    const rankCfg = fm?.rank;
    if (!rankCfg?.enabled || !rankCfg.property) return;

    const files = resolveFilesForCohort(this.app, def);
    if (files.length === 0) return;

    const rankMap = computeRankMap(cohort);

    updateCohortFrontmatter(this.app, files, rankMap, rankCfg.property, undefined, 'Updating ranks in frontmatter...')
      .catch((e) => {
        try { console.error('[Elo] Failed to update ranks in frontmatter', e); } catch {}
      });
  }
}
