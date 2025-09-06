import { App, PluginSettingTab, Setting, TextComponent } from 'obsidian';

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

    // Frontmatter properties
    containerEl.createEl('h4', { text: 'Frontmatter properties' });
    containerEl.createEl('p', {
      text:
        'Choose which Elo statistics to write into a note\'s frontmatter and the property names to use. ' +
        'These are global defaults; cohort-specific overrides can be applied during creation.',
    });

    const fm = this.plugin.settings.frontmatterProperties;

    const addFrontmatterSetting = (
      key: keyof typeof fm,
      label: string,
      desc: string,
      placeholder: string,
    ) => {
      const cfg = fm[key];
      let textRef: TextComponent;

      new Setting(containerEl)
        .setName(label)
        .setDesc(desc)
        .addToggle((t) =>
          t
            .setValue(Boolean(cfg.enabled))
            .onChange(async (val) => {
              cfg.enabled = val;
              if (textRef) textRef.setDisabled(!val);
              await this.plugin.saveSettings();
            }),
        )
        .addText((t) => {
          textRef = t;
          t.setPlaceholder(placeholder)
            .setValue(cfg.property)
            .setDisabled(!cfg.enabled)
            .onChange(async (v) => {
              const trimmed = v.trim();
              cfg.property = trimmed.length > 0 ? trimmed : placeholder;
              await this.plugin.saveSettings();
            });
        });
    };

    addFrontmatterSetting(
      'rating',
      'Rating',
      'Write the current Elo rating to this frontmatter property.',
      'eloRating',
    );
    addFrontmatterSetting(
      'rank',
      'Rank',
      'Write the rank (1 = highest) within the cohort to this frontmatter property.',
      'eloRank',
    );
    addFrontmatterSetting(
      'matches',
      'Matches',
      'Write the total number of matches to this frontmatter property.',
      'eloMatches',
    );
    addFrontmatterSetting(
      'wins',
      'Wins',
      'Write the number of wins to this frontmatter property.',
      'eloWins',
    );
  }
}
