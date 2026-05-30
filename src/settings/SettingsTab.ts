import type { App, Setting, SettingDefinitionItem, SettingGroupItem } from 'obsidian';
import { Notice, PluginSettingTab } from 'obsidian';

import { prettyCohortDefinition, resolveFilesForCohort } from '../domain/cohort/CohortResolver';
import type GlickoPlugin from '../main';
import type { CohortData, CohortDefinition } from '../types';
import { CohortOptionsModal } from '../ui/CohortOptionsModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import {
  computeRanksForAll,
  previewCohortFrontmatterPropertyUpdates,
  updateCohortFrontmatter,
} from '../utils/FrontmatterStats';
import { applyIdTransferPlan, planIdTransfer } from '../utils/IdTransfer';
import { withNotice } from '../utils/safe';
import type { FrontmatterPropertiesSettings, IdLocation } from './settings';
import { DEFAULT_SETTINGS, effectiveFrontmatterProperties } from './settings';
import { migrateIdPropertyName } from './SettingsTabMigration';

type PropKey = keyof FrontmatterPropertiesSettings;

function getByPath(root: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = root;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setByPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (next === null || typeof next !== 'object') {
      const created: Record<string, unknown> = {};
      cur[parts[i]] = created;
      cur = created;
    } else {
      cur = next as Record<string, unknown>;
    }
  }
  cur[parts[parts.length - 1]] = value;
}

const FM_KEY_META: Record<
  PropKey,
  { group: string; toggleName: string; toggleDesc: string; nameDesc: string; defaultProp: string }
> = {
  rating: {
    group: 'Rating',
    toggleName: 'Write rating to frontmatter',
    toggleDesc: 'Write the current Glicko rating to a frontmatter property.',
    nameDesc: 'Frontmatter property used to store the rating.',
    defaultProp: DEFAULT_SETTINGS.frontmatterProperties.rating.property,
  },
  uncertainty: {
    group: 'Uncertainty',
    toggleName: 'Write uncertainty to frontmatter',
    toggleDesc:
      'Write how uncertain the rating is. Starts high and decreases as more comparisons are made.',
    nameDesc: 'Frontmatter property used to store the uncertainty.',
    defaultProp: DEFAULT_SETTINGS.frontmatterProperties.uncertainty.property,
  },
  rank: {
    group: 'Rank',
    toggleName: 'Write rank to frontmatter',
    toggleDesc: 'Write the cohort rank (1 = highest) to a frontmatter property.',
    nameDesc: 'Frontmatter property used to store the rank.',
    defaultProp: DEFAULT_SETTINGS.frontmatterProperties.rank.property,
  },
  matches: {
    group: 'Matches',
    toggleName: 'Write match count to frontmatter',
    toggleDesc: 'Write the number of matches played to a frontmatter property.',
    nameDesc: 'Frontmatter property used to store the match count.',
    defaultProp: DEFAULT_SETTINGS.frontmatterProperties.matches.property,
  },
  wins: {
    group: 'Wins',
    toggleName: 'Write win count to frontmatter',
    toggleDesc: 'Write the number of wins to a frontmatter property.',
    nameDesc: 'Frontmatter property used to store the win count.',
    defaultProp: DEFAULT_SETTINGS.frontmatterProperties.wins.property,
  },
};

const FM_KEYS_ORDERED: readonly PropKey[] = ['rating', 'uncertainty', 'rank', 'matches', 'wins'];

export default class GlickoSettingsTab extends PluginSettingTab {
  icon = 'trophy';
  plugin: GlickoPlugin;

  constructor(app: App, plugin: GlickoPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getControlValue(key: string): unknown {
    return getByPath(this.plugin.settings, key);
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    setByPath(this.plugin.settings as unknown as Record<string, unknown>, key, value);
    await this.plugin.saveSettings();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'Show win/draw notices',
        desc: `Show a toast with the winner after each comparison. Default: ${
          DEFAULT_SETTINGS.showToasts ? 'On' : 'Off'
        }.`,
        control: { type: 'toggle', key: 'showToasts' },
      },
      {
        name: 'Session layout',
        desc: 'Choose how and where the arena opens.',
        control: {
          type: 'dropdown',
          key: 'sessionLayout',
          defaultValue: DEFAULT_SETTINGS.sessionLayout,
          options: {
            'reuse-active': 'Reuse active pane',
            'right-split': 'Insert to the right of active pane',
            'new-tab': 'New tab',
            'new-window': 'New window (pop-out)',
          },
        },
      },
      {
        name: 'Note ID location',
        desc: 'Where to store the note ID.',
        render: (setting) => this.renderIdLocation(setting),
      },
      {
        name: 'Note ID property name',
        desc: 'The frontmatter property (or HTML comment tag) used to store note IDs.',
        render: (setting) => this.renderIdPropertyName(setting),
      },
      {
        name: 'Templates folder',
        desc: 'Excludes templates from cohorts to keep note IDs from appearing on them.',
        control: {
          type: 'folder',
          key: 'templatesFolderPath',
          placeholder: 'Templates',
          includeRoot: false,
        },
      },
      {
        type: 'group',
        heading: 'Progress bar',
        items: [
          {
            name: 'Highlight surprising results',
            desc: `Wobble the progress bar when a match result is unexpected. Default: ${
              DEFAULT_SETTINGS.surpriseJitter ? 'On' : 'Off'
            }.`,
            control: { type: 'toggle', key: 'surpriseJitter' },
          },
          {
            name: 'Stability threshold',
            desc: `Uncertainty value at which the progress bar reaches 100%. Lower values require more matches. Default: ${DEFAULT_SETTINGS.stabilityThreshold}.`,
            control: {
              type: 'slider',
              key: 'stabilityThreshold',
              min: 80,
              max: 250,
              step: 10,
            },
          },
        ],
      },
      this.cohortListDefinition(),
      {
        type: 'group',
        heading: 'Cohort defaults',
        items: [
          {
            type: 'page',
            name: 'Default frontmatter properties',
            desc: 'Choose which Glicko statistics to write into frontmatter and the property names to use.',
            items: this.frontmatterDefaultsPageItems(),
          },
          {
            type: 'page',
            name: 'Post-session report defaults',
            desc: 'Defaults used when configuring reports on a new cohort.',
            items: this.reportDefaultsPageItems(),
          },
        ],
      },
      {
        name: 'Debug logging',
        desc: 'Log detailed debug information to the developer console.',
        control: { type: 'toggle', key: 'debugLogging' },
      },
    ];
  }

  private renderIdLocation(setting: Setting): void {
    setting.addDropdown((dd) => {
      dd.addOptions({
        frontmatter: 'Frontmatter (YAML)',
        end: 'End of note (HTML comment)',
      })
        .setValue(this.plugin.settings.idLocation ?? 'frontmatter')
        .onChange((v) => {
          void this.applyIdLocationChange(v);
        });
    });
  }

  private async applyIdLocationChange(v: string): Promise<void> {
    const oldLoc: IdLocation = this.plugin.settings.idLocation ?? 'frontmatter';
    const newLoc: IdLocation = v === 'end' ? 'end' : 'frontmatter';
    if (newLoc === oldLoc) return;

    this.plugin.settings.idLocation = newLoc;
    await this.plugin.saveSettings();

    const files = this.app.vault.getMarkdownFiles();
    if (files.length === 0) return;

    const propName = this.plugin.settings.idPropertyName;
    let plan;
    try {
      plan = await withNotice('Scanning notes for note IDs...', () =>
        planIdTransfer(
          this.app,
          files,
          { propertyName: propName, location: oldLoc },
          { propertyName: propName, location: newLoc },
        ),
      );
    } catch (e) {
      console.error('[Glicko] Failed to plan note ID transfer', e);
      new Notice('Failed to scan notes for note IDs.');
      return;
    }

    if (plan.wouldUpdate === 0) return;

    const locLabel = (loc: IdLocation) =>
      loc === 'frontmatter' ? 'frontmatter' : 'end-of-note HTML comment';

    const msg =
      `Move note IDs from ${locLabel(oldLoc)} to ${locLabel(newLoc)} for ${plan.wouldUpdate} note${
        plan.wouldUpdate === 1 ? '' : 's'
      }?` +
      (plan.mismatches > 0
        ? `\n\n${plan.mismatches} note${plan.mismatches === 1 ? ' has' : 's have'} differing IDs in frontmatter and the end-of-note HTML comment. The ID in the end-of-note HTML comment will be removed, and the frontmatter ID will be ${
            newLoc === 'frontmatter' ? 'kept' : 'moved to the end-of-note HTML comment'
          }.`
        : '') +
      `\n\nIf you choose not to move any IDs to the new location, IDs left in the old location will continue to work. If a note has both IDs, the frontmatter ID is used.`;

    const ok = await new ConfirmModal(
      this.app,
      'Move note IDs?',
      msg,
      'Yes, move',
      'No, leave as-is',
    ).openAndConfirm();

    if (!ok) return;

    const res = await applyIdTransferPlan(this.app, plan, {
      noticeMessage: 'Moving note IDs...',
    });

    new Notice(
      `Moved note IDs in ${res.updated} note${res.updated === 1 ? '' : 's'}` +
        (res.mismatches > 0
          ? ` (${res.mismatches} mismatch${res.mismatches === 1 ? '' : 'es'} resolved).`
          : '.'),
    );
  }

  private renderIdPropertyName(setting: Setting): void {
    setting.addText((t) => {
      t.setValue(this.plugin.settings.idPropertyName).setPlaceholder(
        DEFAULT_SETTINGS.idPropertyName,
      );

      t.inputEl.addEventListener('blur', () => {
        const trimmed = (t.getValue() ?? '').trim();
        if (!trimmed || trimmed === this.plugin.settings.idPropertyName) return;

        void (async () => {
          await migrateIdPropertyName(this.app, this.plugin, trimmed);
          this.update();
        })();
      });
    });
  }

  private cohortListDefinition(): SettingDefinitionItem {
    const sorted = this.sortedCohortDefs();
    return {
      type: 'list',
      heading: 'Cohorts',
      emptyState:
        'No cohorts saved yet. Start a session to create one, or use the command palette.',
      onDelete: (idx) => {
        const def = this.sortedCohortDefs()[idx];
        if (!def) return;
        void this.deleteCohortWithConfirm(def.key);
      },
      items: sorted.map(
        (def): SettingGroupItem => ({
          name: def.label ?? prettyCohortDefinition(def),
          desc: `Definition: ${prettyCohortDefinition(def)}`,
          render: (setting) => this.renderCohortRow(setting, def.key),
        }),
      ),
    };
  }

  private sortedCohortDefs(): CohortDefinition[] {
    return this.plugin.dataStore
      .listCohortDefs()
      .slice()
      .sort((a, b) => {
        const an = (a.label ?? prettyCohortDefinition(a)).toLowerCase();
        const bn = (b.label ?? prettyCohortDefinition(b)).toLowerCase();
        return an.localeCompare(bn);
      });
  }

  private renderCohortRow(setting: Setting, cohortKey: string): void {
    setting.infoEl.addClass('glicko-cohort-item-info');
    setting.infoEl.addEventListener('click', () => {
      void this.configureCohort(cohortKey);
    });

    setting.addExtraButton((b) =>
      b
        .setIcon('settings')
        .setTooltip('Configure')
        .onClick(() => {
          void this.configureCohort(cohortKey);
        }),
    );
  }

  private frontmatterDefaultsPageItems(): SettingDefinitionItem[] {
    const items: SettingDefinitionItem[] = [
      {
        name: 'Ask for per-cohort overrides on creation',
        desc: `When creating a cohort, prompt to set frontmatter overrides. Turn off to always use the global defaults. Default: ${
          DEFAULT_SETTINGS.askForOverridesOnCohortCreation ? 'On' : 'Off'
        }.`,
        control: { type: 'toggle', key: 'askForOverridesOnCohortCreation' },
      },
    ];

    for (const key of FM_KEYS_ORDERED) {
      const meta = FM_KEY_META[key];
      items.push({
        type: 'group',
        heading: meta.group,
        items: [
          {
            name: meta.toggleName,
            desc: meta.toggleDesc,
            control: {
              type: 'toggle',
              key: `frontmatterProperties.${key}.enabled`,
            },
          },
          {
            name: 'Property name',
            desc: meta.nameDesc,
            control: {
              type: 'text',
              key: `frontmatterProperties.${key}.property`,
              placeholder: meta.defaultProp,
              disabled: () => !this.plugin.settings.frontmatterProperties[key].enabled,
            },
          },
        ],
      });
    }

    return items;
  }

  private reportDefaultsPageItems(): SettingDefinitionItem[] {
    return [
      {
        name: 'Ask for report settings on creation',
        desc: `When creating a cohort, prompt to configure report settings. Turn off to always use the defaults below. Default: ${
          DEFAULT_SETTINGS.askForReportSettingsOnCreation ? 'On' : 'Off'
        }.`,
        control: { type: 'toggle', key: 'askForReportSettingsOnCreation' },
      },
      {
        name: 'Enable reports by default',
        desc: 'Generate a post-session report for new cohorts by default.',
        control: { type: 'toggle', key: 'sessionReport.enabled' },
      },
      {
        name: 'Default report folder',
        desc: 'Pre-filled vault-relative folder for session reports.',
        control: {
          type: 'text',
          key: 'sessionReport.folderPath',
          placeholder: DEFAULT_SETTINGS.sessionReport.folderPath,
        },
      },
      {
        name: 'Default report name',
        desc: 'Available: {{cohort}}, {{date}}, {{datetime}}, {{count}}',
        control: {
          type: 'text',
          key: 'sessionReport.nameTemplate',
          placeholder: DEFAULT_SETTINGS.sessionReport.nameTemplate,
        },
      },
      {
        name: 'Default report template',
        desc: 'Vault path to a markdown file with {{glicko:...}} placeholders. Leave blank to use the built-in template.',
        render: (setting) => this.renderReportTemplate(setting),
      },
    ];
  }

  private renderReportTemplate(setting: Setting): void {
    setting
      .addText((t) =>
        t
          .setPlaceholder('e.g. Templates/My Report.md')
          .setValue(this.plugin.settings.sessionReport.reportTemplatePath ?? '')
          .onChange((v) => {
            this.plugin.settings.sessionReport.reportTemplatePath = (v ?? '').trim() || undefined;
            void this.plugin.saveSettings();
          }),
      )
      .addButton((b) =>
        b.setButtonText('Generate template').onClick(() => {
          void this.generateReportTemplate();
        }),
      );
  }

  private async generateReportTemplate(): Promise<void> {
    try {
      const { generateOrOverwriteExampleTemplate } =
        await import('../domain/report/generateExampleTemplate');
      const file = await generateOrOverwriteExampleTemplate(this.app, {
        filePath: this.plugin.settings.sessionReport.reportTemplatePath,
        templatesFolderPath:
          this.plugin.settings.templatesFolderPath ||
          this.plugin.settings.sessionReport.folderPath ||
          '',
      });
      if (!file) return;

      this.plugin.settings.sessionReport.reportTemplatePath = file.path;
      await this.plugin.saveSettings();
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.openFile(file);
      this.update();
      new Notice('Report template created and set as default.');
    } catch (e) {
      console.error('[Glicko] Failed to generate example template', e);
      new Notice('Failed to generate example template.');
    }
  }

  private async deleteCohortWithConfirm(cohortKey: string): Promise<void> {
    const def = this.plugin.dataStore.getCohortDef(cohortKey);
    const label = def ? (def.label ?? prettyCohortDefinition(def)) : 'Cohort';

    const ok = await new ConfirmModal(
      this.app,
      'Delete cohort?',
      `Are you sure you want to delete "${label}"? This removes the cohort and its saved ratings. Your notes will not be modified.`,
      'Delete',
      'Cancel',
      true,
    ).openAndConfirm();
    if (!ok) return;

    // Remove data and definition
    const store = this.plugin.dataStore.store;
    if (store.cohorts && store.cohorts[cohortKey]) delete store.cohorts[cohortKey];
    if (store.cohortDefs && store.cohortDefs[cohortKey]) delete store.cohortDefs[cohortKey];
    if (store.lastUsedCohortKey === cohortKey) store.lastUsedCohortKey = undefined;
    await this.plugin.dataStore.saveStore();

    new Notice(`Deleted cohort: ${label}`);
    this.update();
  }

  private async configureCohort(cohortKey: string): Promise<void> {
    const def = this.plugin.dataStore.getCohortDef(cohortKey);
    if (!def) return;

    const res = await new CohortOptionsModal(this.app, this.plugin, {
      mode: 'edit',
      initial: def.frontmatterOverrides,
      initialName: def.label ?? '',
      initialScrollStart: def.scrollStart,
      initialSyncScroll: def.syncScroll ?? true,
      initialSessionReport: def.sessionReport,
    }).openAndGetOptions();

    if (!res) return;

    const overrides = res.overrides ?? {};

    // Compute old vs new effective config, then save new overrides and name
    const base = this.plugin.settings.frontmatterProperties;
    const oldEffective = effectiveFrontmatterProperties(base, def.frontmatterOverrides);
    const newEffective = effectiveFrontmatterProperties(base, overrides);

    // Persist properties overrides (clear if no keys), label, and initial scroll
    const hasKeys = Object.keys(overrides).length > 0;
    def.frontmatterOverrides = hasKeys ? overrides : undefined;

    const newName = (res.name ?? '').trim();
    def.label = newName.length > 0 ? newName : undefined;

    def.scrollStart = res.scrollStart && res.scrollStart !== 'none' ? res.scrollStart : undefined;

    def.syncScroll = res.syncScroll ?? true;

    if (res.sessionReport) {
      def.sessionReport = res.sessionReport;
    }

    this.plugin.dataStore.upsertCohortDef(def);
    await this.plugin.dataStore.saveStore();
    this.update();

    // Determine changes that require optional bulk updates
    const changed: Array<{
      key: PropKey;
      action: 'rename' | 'remove' | 'upsert';
      oldProp?: string;
      newProp?: string;
    }> = [];

    const keys: PropKey[] = ['rating', 'uncertainty', 'rank', 'matches', 'wins'];
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

    const files = await resolveFilesForCohort(this.app, def, {
      excludeFolderPath: this.plugin.settings.templatesFolderPath,
    });
    if (files.length === 0) return;

    const idPropName = this.plugin.settings.idPropertyName;
    const cohort: CohortData | undefined = this.plugin.dataStore.store.cohorts[cohortKey];
    const valuesFor = (key: PropKey): Map<string, number> => {
      const map = new Map<string, number>();
      if (!cohort) return map;
      if (key === 'rank') {
        const rankMap = computeRanksForAll(cohort);
        for (const [id, rank] of rankMap) map.set(id, rank);
      } else if (key === 'rating') {
        for (const [id, p] of Object.entries(cohort.players)) map.set(id, Math.round(p.rating));
      } else if (key === 'uncertainty') {
        for (const [id, p] of Object.entries(cohort.players)) map.set(id, Math.round(p.sigma));
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
          idPropName,
        );
        if (preview.wouldUpdate === 0) continue;

        const ok = await new ConfirmModal(
          this.app,
          'Remove cohort property?',
          `Remove frontmatter property "${change.oldProp}" from ${preview.wouldUpdate} notes in this cohort?`,
          'Yes, remove',
          "No, don't update",
        ).openAndConfirm();
        if (!ok) continue;

        const res = await updateCohortFrontmatter(
          this.app,
          files,
          new Map(),
          '',
          change.oldProp,
          `Removing "${change.oldProp}" from ${preview.wouldUpdate} notes...`,
          idPropName,
        );
        new Notice(`Removed "${change.oldProp}" from ${res.updated} notes.`);
      } else if (change.action === 'rename' && change.oldProp && change.newProp) {
        const preview = await previewCohortFrontmatterPropertyUpdates(
          this.app,
          files,
          vals,
          change.newProp,
          change.oldProp,
          idPropName,
        );
        if (preview.wouldUpdate === 0) continue;

        const ok = await new ConfirmModal(
          this.app,
          'Rename cohort property?',
          `Rename frontmatter property "${change.oldProp}" to "${change.newProp}" on ${preview.wouldUpdate} notes in this cohort?`,
          'Yes, rename',
          "No, don't rename",
        ).openAndConfirm();
        if (!ok) continue;

        const res = await updateCohortFrontmatter(
          this.app,
          files,
          vals,
          change.newProp,
          change.oldProp,
          `Renaming "${change.oldProp}" to "${change.newProp}" on ${preview.wouldUpdate} notes...`,
          idPropName,
        );
        new Notice(`Updated ${res.updated} notes.`);
      } else if (change.action === 'upsert' && change.newProp) {
        const preview = await previewCohortFrontmatterPropertyUpdates(
          this.app,
          files,
          vals,
          change.newProp,
          undefined,
          idPropName,
        );
        if (preview.wouldUpdate === 0) continue;

        const ok = await new ConfirmModal(
          this.app,
          'Write cohort property?',
          `Write frontmatter property "${change.newProp}" to ${preview.wouldUpdate} notes in this cohort?`,
          'Yes, write',
          "No, don't write",
        ).openAndConfirm();
        if (!ok) continue;

        const res = await updateCohortFrontmatter(
          this.app,
          files,
          vals,
          change.newProp,
          undefined,
          `Writing "${change.newProp}" to ${preview.wouldUpdate} notes...`,
          idPropName,
        );
        new Notice(`Wrote "${change.newProp}" on ${res.updated} notes.`);
      }
    }
  }
}
