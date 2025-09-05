import { App, PluginSettingTab, Setting } from 'obsidian';

import type EloPlugin from '../main';

export default class EloSettingsTab extends PluginSettingTab {
  plugin: EloPlugin;

  constructor(app: App, plugin: EloPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h3', { text: 'Pairwise Elo Ranking' });

    new Setting(containerEl)
      .setName('K-factor')
      .setDesc('Adjusts how quickly ratings move. Typical values are 16–40.')
      .addText((t) =>
        t
          .setPlaceholder('24')
          .setValue(String(this.plugin.settings.kFactor))
          .onChange(async (v) => {
            const num = Number(v);
            if (!Number.isNaN(num) && num > 0) {
              this.plugin.settings.kFactor = num;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName('Show win/draw notices')
      .setDesc('Show a toast with the winner after each comparison.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showToasts).onChange(async (v) => {
          this.plugin.settings.showToasts = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('eloId location')
      .setDesc('Where to store the Elo ID when creating a new one. The plugin can support a mix of both. If both are found, the plugin will use the frontmatter ID.')
      .addDropdown((dd) => {
        dd.addOptions({
          frontmatter: 'Frontmatter (YAML)',
          end: 'End of note (HTML comment)',
        })
          .setValue(this.plugin.settings.eloIdLocation ?? 'frontmatter')
          .onChange(async (v) => {
            const val = v === 'end' ? 'end' : 'frontmatter';
            this.plugin.settings.eloIdLocation = val;
            await this.plugin.saveSettings();
          });
      });
  }
}
