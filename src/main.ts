import { DEFAULT_SETTINGS, EloSettings } from './settings/settings';

import EloSettingsTab from './settings/SettingsTab';
import { Plugin } from 'obsidian';

export default class EloPlugin extends Plugin {
  settings: EloSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new EloSettingsTab(this.app, this));
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
