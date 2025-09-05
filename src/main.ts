import { App, Notice, Plugin, TAbstractFile, TFile } from 'obsidian';

import ArenaSession from './ui/ArenaSession';
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

    this.addRibbonIcon('trophy', 'Elo: Quick session', () => {
      const files = this.getCohortFiles();
      if (files.length < 2) {
        new Notice('Need at least two Markdown notes to compare.');
        return;
      }
      this.startQuickSession(files);
    });

    this.addCommand({
      id: 'elo-quick-session-active-folder',
      name: 'Elo: Quick rating (active folder)',
      checkCallback: (checking) => {
        const files = this.getCohortFiles();
        if (files.length >= 2) {
          if (!checking) this.startQuickSession(files);
          return true;
        }
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

  private startQuickSession(files: TFile[]) {
    const cohortKey = this.getCohortKey();

    // End any existing session first
    this.endSession();

    this.currentSession = new ArenaSession(this.app, this, cohortKey, files);
    // Clean up automatically if the plugin unloads
    this.register(() => this.currentSession?.end());
    this.currentSession.start();
  }

  private endSession() {
    if (this.currentSession) {
      this.currentSession.end();
      this.currentSession = undefined;
    }
  }

  private getCohortKey(): string {
    const active = this.app.workspace.getActiveFile();
    if (active?.parent) return `folder:${active.parent.path}`;
    return 'vault:all';
  }

  private getCohortFiles(): TFile[] {
    const all = this.app.vault.getMarkdownFiles();
    const active = this.app.workspace.getActiveFile();

    if (active?.parent) {
      const folderPath = active.parent.path;
      return all.filter((f) => f.parent?.path === folderPath);
    }
    return all;
  }
}
