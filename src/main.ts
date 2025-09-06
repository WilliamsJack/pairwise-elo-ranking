import { App, Notice, Plugin, TAbstractFile, TFile } from 'obsidian';
import { createDefinition, resolveFilesForCohort } from './domain/cohort/CohortResolver';

import ArenaSession from './ui/ArenaSession';
import { CohortDefinition } from './types';
import { CohortPicker } from './ui/CohortPicker';
import { EloSettings } from './settings/settings';
import EloSettingsTab from './settings/SettingsTab';
import { PluginDataStore } from './storage/PluginDataStore';

export default class EloPlugin extends Plugin {
  dataStore: PluginDataStore;
  settings: EloSettings;

  private currentSession?: ArenaSession;

  async onload() {
    this.dataStore = new PluginDataStore(this);
    await this.dataStore.load();
    this.settings = this.dataStore.settings;

    this.addRibbonIcon('trophy', 'Elo: Start rating session…', async () => {
      await this.selectCohortAndStart();
    });

    this.addCommand({
      id: 'elo-start-session',
      name: 'Elo: Start rating session…',
      callback: async () => {
        await this.selectCohortAndStart();
      },
    });

    this.addCommand({
      id: 'elo-end-session',
      name: 'Elo: End current session',
      checkCallback: (checking) => {
        const has = !!this.currentSession;
        if (!checking && has) this.endSession();
        return has;
      },
    });

    // Keep the session UI in sync with renames
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
  }

  async saveSettings() {
    await this.dataStore.saveSettings();
  }

  private async selectCohortAndStart() {
    const picker = new CohortPicker(this.app, this);
    const def = await picker.openAndGetSelection();
    if (!def) return;

    const files = resolveFilesForCohort(this.app, def);
    if (files.length < 2) {
      new Notice('Need at least two Markdown notes to compare.');
      return;
    }

    // Save this definition if it's not already saved (only for non-ephemeral types)
    if (!this.dataStore.getCohortDef(def.key)) {
      this.dataStore.upsertCohortDef(def);
      await this.dataStore.saveStore();
    }

    this.startSessionForCohort(def, files, { saveDef: false });
  }

  private startSessionForCohort(def: CohortDefinition, files: TFile[], opts?: { saveDef?: boolean }) {
    // End any existing session first
    this.endSession();

    this.currentSession = new ArenaSession(this.app, this, def.key, files);
    this.register(() => this.endSession());
    this.currentSession.start();

    this.dataStore.setLastUsedCohortKey(def.key);
    void this.dataStore.saveStore();
  }

  public endSession() {
    if (this.currentSession) {
      this.currentSession.end();
      this.currentSession = undefined;
    }
  }
}
