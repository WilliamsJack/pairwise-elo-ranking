import { App, ButtonComponent, Modal, Notice, PluginSettingTab, Setting, TextComponent } from 'obsidian';
import { FrontmatterPropertiesSettings, effectiveFrontmatterProperties } from './settings';
import { computeRankMap, previewCohortFrontmatterPropertyUpdates, updateCohortFrontmatter } from '../utils/FrontmatterStats';
import { labelForDefinition, resolveFilesForCohort } from '../domain/cohort/CohortResolver';

import type { CohortData } from '../types';
import { CohortFrontmatterOptionsModal } from '../ui/CohortFrontmatterOptionsModal';
import type EloPlugin from '../main';

type PropKey = keyof FrontmatterPropertiesSettings;

class ConfirmModal extends Modal {
  private titleText: string;
  private message: string;
  private ctaText: string;
  private resolver?: (ok: boolean) => void;
  private resolved = false;

  constructor(app: App, titleText: string, message: string, ctaText: string) {
    super(app);
    this.titleText = titleText;
    this.message = message;
    this.ctaText = ctaText;
  }

  async openAndConfirm(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: this.titleText });
    const p = contentEl.createEl('p');
    p.textContent = this.message;

    const btns = new Setting(contentEl);
    btns.addButton((b) => b.setButtonText('Cancel').onClick(() => this.finish(false)));
    btns.addButton((b) => b.setCta().setButtonText(this.ctaText).onClick(() => this.finish(true)));
  }

  private finish(ok: boolean) {
    if (this.resolved) return;
    this.resolved = true;
    const r = this.resolver;
    this.resolver = undefined;
    r?.(ok);
    this.close();
  }

  onClose(): void {
    if (!this.resolved) this.finish(false);
  }
}

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

    const minK = 8;
    const maxK = 64;
    const stepK = 1;
    let initialK = this.plugin.settings.kFactor;
    if (!Number.isFinite(initialK)) initialK = 24;
    initialK = Math.min(maxK, Math.max(minK, Math.round(initialK)));

    new Setting(containerEl)
      .setName('K-factor')
      .setDesc('Adjusts how quickly ratings move. Typical values are 16–40.')
      .addSlider((s) => {
        s.setLimits(minK, maxK, stepK)
          .setValue(initialK)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.kFactor = value;
            await this.plugin.saveSettings();
          });
      });

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
      .setName('Elo ID location')
      .setDesc('Where to store the Elo ID. Changing this setting will not move existing IDs, but they will continue to work.')
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

    // Frontmatter properties (global defaults)
    containerEl.createEl('h4', { text: 'Default Frontmatter properties' });

    new Setting(containerEl)
      .setName('Ask for per-cohort overrides on creation')
      .setDesc('When creating a cohort, prompt to set frontmatter overrides. Turn off to always use the global defaults. Disabling this will cause clashes if you choose to use frontmatter properties and have notes in multiple cohorts.')
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.askForOverridesOnCohortCreation)
          .onChange(async (v) => {
            this.plugin.settings.askForOverridesOnCohortCreation = v;
            await this.plugin.saveSettings();
          }),
      );

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

    // Cohort configuration section
    containerEl.createEl('h4', { text: 'Cohorts' });
    containerEl.createEl('p', {
      text: 'Configure existing cohorts\' frontmatter properties.',
    });

    const defs = this.plugin.dataStore.listCohortDefs();
    if (defs.length === 0) {
      const hint = containerEl.createEl('div');
      hint.textContent = 'No cohorts saved yet. Start a session to create one, or use the Command Palette.';
      hint.style.opacity = '0.7';
    } else {
      for (const def of defs) {
        const s = new Setting(containerEl)
          .setName(labelForDefinition(def))
          .setDesc('Configure frontmatter properties for this cohort.')
          .addButton((b) =>
            b
              .setButtonText('Configure...')
              .onClick(async () => {
                await this.configureCohort(def.key);
              }),
          );
      }
    }
  }

  private async configureCohort(cohortKey: string): Promise<void> {
    const def = this.plugin.dataStore.getCohortDef(cohortKey);
    if (!def) return;

    const overrides = await new CohortFrontmatterOptionsModal(this.app, this.plugin, {
      mode: 'edit',
      initial: def.frontmatterOverrides,
    }).openAndGetOverrides();

    if (!overrides) return;

    // Compute old vs new effective config, then save new overrides
    const base = this.plugin.settings.frontmatterProperties;
    const oldEffective = effectiveFrontmatterProperties(base, def.frontmatterOverrides);
    const newEffective = effectiveFrontmatterProperties(base, overrides);

    // Persist: if overrides ended up empty (no keys), clear from def
    const hasKeys = Object.keys(overrides).length > 0;
    def.frontmatterOverrides = hasKeys ? overrides : undefined;
    this.plugin.dataStore.upsertCohortDef(def);
    await this.plugin.dataStore.saveStore();
    this.display(); // refresh UI

    // Determine changes that require optional bulk updates
    const changed: Array<{
      key: PropKey;
      action: 'rename' | 'remove' | 'upsert';
      oldProp?: string;
      newProp?: string;
    }> = [];

    const keys: PropKey[] = ['rating', 'rank', 'matches', 'wins'];
    for (const key of keys) {
      const oldCfg = oldEffective[key];
      const newCfg = newEffective[key];

      if (oldCfg.enabled && !newCfg.enabled) {
        changed.push({ key, action: 'remove', oldProp: oldCfg.property });
        continue;
      }
      if (newCfg.enabled && oldCfg.enabled && oldCfg.property !== newCfg.property) {
        changed.push({ key, action: 'rename', oldProp: oldCfg.property, newProp: newCfg.property });
        continue;
      }
      if (!oldCfg.enabled && newCfg.enabled) {
        changed.push({ key, action: 'upsert', newProp: newCfg.property });
        continue;
      }
    }

    if (changed.length === 0) return;

    const files = resolveFilesForCohort(this.app, def);
    if (files.length === 0) return;

    const cohort: CohortData | undefined = this.plugin.dataStore.store.cohorts[cohortKey];
    const valuesFor = (key: PropKey): Map<string, number> => {
      const map = new Map<string, number>();
      if (!cohort) return map;
      if (key === 'rank') {
        const rankMap = computeRankMap(cohort);
        for (const [id, rank] of rankMap) map.set(id, rank);
      } else if (key === 'rating') {
        for (const [id, p] of Object.entries(cohort.players)) map.set(id, Math.round(p.rating));
      } else if (key === 'matches') {
        for (const [id, p] of Object.entries(cohort.players)) map.set(id, p.matches);
      } else if (key === 'wins') {
        for (const [id, p] of Object.entries(cohort.players)) map.set(id, p.wins);
      }
      return map;
    };

    // Run prompts sequentially
    for (const change of changed) {
      const key = change.key;
      const vals = valuesFor(key);

      if (change.action === 'remove' && change.oldProp) {
        const preview = await previewCohortFrontmatterPropertyUpdates(
          this.app,
          files,
          new Map(),
          '',
          change.oldProp,
        );
        if (preview.wouldUpdate === 0) continue;

        const ok = await new ConfirmModal(
          this.app,
          'Remove cohort property?',
          `Remove frontmatter property "${change.oldProp}" from ${preview.wouldUpdate} note(s) in this cohort?`,
          'Remove',
        ).openAndConfirm();
        if (!ok) continue;

        const res = await updateCohortFrontmatter(
          this.app,
          files,
          new Map(),
          '',
          change.oldProp,
          `Removing "${change.oldProp}" from ${preview.wouldUpdate} note(s)...`,
        );
        new Notice(`Removed "${change.oldProp}" from ${res.updated} note(s).`);
      } else if (change.action === 'rename' && change.oldProp && change.newProp) {
        const preview = await previewCohortFrontmatterPropertyUpdates(
          this.app,
          files,
          vals,
          change.newProp,
          change.oldProp,
        );
        if (preview.wouldUpdate === 0) continue;

        const ok = await new ConfirmModal(
          this.app,
          'Rename cohort property?',
          `Rename frontmatter property "${change.oldProp}" to "${change.newProp}" on ${preview.wouldUpdate} note(s) in this cohort?`,
          'Rename',
        ).openAndConfirm();
        if (!ok) continue;

        const res = await updateCohortFrontmatter(
          this.app,
          files,
          vals,
          change.newProp,
          change.oldProp,
          `Renaming "${change.oldProp}" to "${change.newProp}" on ${preview.wouldUpdate} note(s)...`,
        );
        new Notice(`Updated ${res.updated} note(s).`);
      } else if (change.action === 'upsert' && change.newProp) {
        const preview = await previewCohortFrontmatterPropertyUpdates(
          this.app,
          files,
          vals,
          change.newProp,
        );
        if (preview.wouldUpdate === 0) continue;

        const ok = await new ConfirmModal(
          this.app,
          'Write cohort property?',
          `Write frontmatter property "${change.newProp}" to ${preview.wouldUpdate} note(s) in this cohort?`,
          'Write',
        ).openAndConfirm();
        if (!ok) continue;
    
        const res = await updateCohortFrontmatter(
          this.app,
          files,
          vals,
          change.newProp,
          undefined,
          `Writing "${change.newProp}" to ${preview.wouldUpdate} note(s)...`,
        );
        new Notice(`Wrote "${change.newProp}" on ${res.updated} note(s).`);
      }
    }
  }
}
