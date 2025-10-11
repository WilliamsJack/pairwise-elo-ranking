import { App, Setting } from 'obsidian';
import { FM_PROP_KEYS, renderStandardFmPropertyRow } from './FrontmatterPropertyRow';
import type { FrontmatterPropertiesSettings, FrontmatterPropertyConfig } from '../settings';

import { BasePromiseModal } from './PromiseModal';
import type EloPlugin from '../main';
import type { ScrollStartMode } from '../types';

type Mode = 'create' | 'edit';

type Key = keyof FrontmatterPropertiesSettings;

type RowState = {
  key: Key;
  enabled: boolean;
  property: string;
  overridden: boolean;
};

export type CohortOptionsResult = {
  overrides: Partial<FrontmatterPropertiesSettings>;
  name?: string;
  scrollStart?: ScrollStartMode;
};

export class CohortOptionsModal extends BasePromiseModal<CohortOptionsResult | undefined> {
  private plugin: EloPlugin;

  private mode: Mode;
  private base: FrontmatterPropertiesSettings;
  private initial?: Partial<FrontmatterPropertiesSettings>;
  private initialName?: string;
  private initialScrollStart?: ScrollStartMode;

  private nameWorking = '';
  private scrollWorking: ScrollStartMode = 'none';

  private working: Record<Key, RowState>;

  constructor(
    app: App,
    plugin: EloPlugin,
    opts?: { mode?: Mode; initial?: Partial<FrontmatterPropertiesSettings>; initialName?: string; initialScrollStart?: ScrollStartMode },
  ) {
    super(app);
    this.plugin = plugin;
    this.mode = opts?.mode ?? 'create';
    this.base = plugin.settings.frontmatterProperties;
    this.initial = opts?.initial;
    this.initialName = (opts?.initialName ?? '').trim();
    this.nameWorking = this.initialName ?? '';

    this.initialScrollStart = opts?.initialScrollStart;
    this.scrollWorking = this.initialScrollStart ?? 'none';

    const mk = (k: Key): RowState => {
      const baseCfg = this.base[k];
      const ovCfg = this.initial?.[k];
      const chosen: FrontmatterPropertyConfig = ovCfg ?? baseCfg;
      return {
        key: k,
        enabled: chosen.enabled,
        property: chosen.property,
        overridden: !!ovCfg, // overridden only if present in initial overrides
      };
    };

    this.working = {
      rating: mk('rating'),
      rank: mk('rank'),
      matches: mk('matches'),
      wins: mk('wins'),
    };
  }

  async openAndGetOptions(): Promise<CohortOptionsResult | undefined> {
    return this.openAndGetValue();
  }

  private updateOverriddenFlag(row: RowState) {
    const baseCfg = this.base[row.key];
    row.overridden = row.enabled !== baseCfg.enabled || row.property !== baseCfg.property;
  }

  private buildOverridesPayload(): Partial<FrontmatterPropertiesSettings> {
    const out: Partial<FrontmatterPropertiesSettings> = {};
    for (const key of Object.keys(this.working) as Key[]) {
      const row = this.working[key];
      this.updateOverriddenFlag(row);
      if (row.overridden) {
        out[key] = { property: row.property.trim(), enabled: !!row.enabled };
      }
    }
    return out;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const desc =
      this.mode === 'create'
        ? 'Set an optional name and configure which Elo statistics to write into frontmatter for this cohort. Global defaults are prefilled.'
        : 'Rename the cohort and adjust which Elo statistics to write into frontmatter. Use Reset to revert a property to the global default.';

    contentEl.createEl('h3', { text: 'Cohort options' });
    contentEl.createEl('p', { text: desc });

    new Setting(contentEl)
      .setName('Cohort name')
      .setDesc('Shown in menus. Optional - leave blank to use an automatic description.')
      .addText((t) =>
        t
          .setPlaceholder('e.g. My Reading List')
          .setValue(this.nameWorking)
          .onChange((v) => {
            this.nameWorking = (v ?? '').trim();
          }),
      );

    const scrollLabels: Record<ScrollStartMode, string> = {
      none: 'No auto-scroll',
      'after-frontmatter': 'Top of content (past frontmatter)',
      'first-heading': 'First heading',
      'first-image': 'First image',
    };

    new Setting(contentEl)
      .setName('Initial scroll position')
      .setDesc('Auto-scroll notes to this position for quicker comparisons.')
      .addDropdown((dd) => {
        dd.addOptions(scrollLabels as Record<string, string>)
          .setValue(this.scrollWorking)
          .onChange((v) => {
            if (v === 'after-frontmatter' || v === 'first-heading' || v === 'first-image' || v === 'none') {
              this.scrollWorking = v;
            } else {
              this.scrollWorking = 'none';
            }
          });
      });

    for (const key of FM_PROP_KEYS) {
      const row = this.working[key];
      const baseCfg = this.base[key];

      renderStandardFmPropertyRow(contentEl, key, {
        value: { enabled: row.enabled, property: row.property },
        base: { enabled: baseCfg.enabled, property: baseCfg.property },
        showReset: true,
        onChange: (next) => {
          row.enabled = !!next.enabled;
          row.property = next.property || baseCfg.property;
          this.updateOverriddenFlag(row);
        },
      });
    }

    const btns = new Setting(contentEl);
    btns.addButton((b) =>
      b.setButtonText('Cancel').onClick(() => {
        this.finish(undefined);
      }),
    );
    btns.addButton((b) =>
      b
        .setCta()
        .setButtonText(this.mode === 'create' ? 'Create cohort' : 'Save changes')
        .onClick(() => {
          const result: CohortOptionsResult = {
            overrides: this.buildOverridesPayload(),
            name: this.nameWorking || undefined,
            scrollStart: this.scrollWorking,
          };
          this.finish(result);
        }),
    );
  }
}
