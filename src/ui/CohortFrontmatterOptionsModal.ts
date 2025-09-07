import { App, ButtonComponent, Modal, Setting, TextComponent, ToggleComponent } from 'obsidian';
import type { FrontmatterPropertiesSettings, FrontmatterPropertyConfig } from '../settings/settings';

import type EloPlugin from '../../main';

type Mode = 'create' | 'edit';

type Key = keyof FrontmatterPropertiesSettings;

type RowState = {
  key: Key;
  enabled: boolean;
  property: string;
  overridden: boolean;
};

export class CohortFrontmatterOptionsModal extends Modal {
  private plugin: EloPlugin;
  private resolver?: (overrides?: Partial<FrontmatterPropertiesSettings>) => void;
  private resolved = false;

  private mode: Mode;
  private base: FrontmatterPropertiesSettings;
  private initial?: Partial<FrontmatterPropertiesSettings>;

  private working: Record<Key, RowState>;

  constructor(app: App, plugin: EloPlugin, opts?: { mode?: Mode; initial?: Partial<FrontmatterPropertiesSettings> }) {
    super(app);
    this.plugin = plugin;
    this.mode = opts?.mode ?? 'create';
    this.base = plugin.settings.frontmatterProperties;
    this.initial = opts?.initial;

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

  async openAndGetOverrides(): Promise<Partial<FrontmatterPropertiesSettings> | undefined> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  private resetRowToDefault(row: RowState, textRef?: TextComponent) {
    const baseCfg = this.base[row.key];
    row.enabled = baseCfg.enabled;
    row.property = baseCfg.property;
    row.overridden = false;
    if (textRef) {
      textRef.setValue(row.property);
      textRef.setDisabled(!row.enabled);
    }
  }

  private updateOverriddenFlag(row: RowState) {
    const baseCfg = this.base[row.key];
    row.overridden = (row.enabled !== baseCfg.enabled) || (row.property !== baseCfg.property);
  }

  private buildOverridesPayload(): Partial<FrontmatterPropertiesSettings> {
    const out: Partial<FrontmatterPropertiesSettings> = {};
    for (const key of Object.keys(this.working) as Key[]) {
      const row = this.working[key];
      this.updateOverriddenFlag(row);
      if (row.overridden) {
        (out as any)[key] = { property: row.property.trim(), enabled: !!row.enabled } as FrontmatterPropertyConfig;
      }
    }
    return out;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const header = this.mode === 'create' ? 'Cohort options' : 'Configure cohort properties';
    const desc = this.mode === 'create'
      ? 'Configure which Elo statistics to write into frontmatter for this cohort and the property names to use. These defaults are prefilled from the plugin settings.'
      : 'Adjust which Elo statistics to write into frontmatter for this cohort and the property names. Use Reset to revert an individual property to the global default.';

    contentEl.createEl('h3', { text: header });
    contentEl.createEl('p', { text: desc });

    const addRow = (key: Key, label: string, help: string) => {
      const row = this.working[key];
      let textRef: TextComponent | undefined;

      const s = new Setting(contentEl)
        .setName(label)
        .setDesc(help)
        .addToggle((t: ToggleComponent) =>
          t
            .setValue(Boolean(row.enabled))
            .onChange((val) => {
              row.enabled = val;
              if (textRef) textRef.setDisabled(!val);
              this.updateOverriddenFlag(row);
            }),
        )
        .addText((t) => {
          textRef = t;
          t.setPlaceholder(this.base[key].property || '')
            .setValue(row.property)
            .setDisabled(!row.enabled)
            .onChange((v) => {
              row.property = (v ?? '').trim() || this.base[key].property;
              this.updateOverriddenFlag(row);
            });
        });

      if (this.mode === 'edit') {
        s.addButton((b: ButtonComponent) =>
          b
            .setButtonText('Reset')
            .setTooltip('Reset to global default')
            .onClick(() => this.resetRowToDefault(row, textRef)),
        );
      }
    };

    addRow('rating', 'Rating', 'Write the current Elo rating to this property.');
    addRow('rank', 'Rank', 'Write the cohort rank (1 = highest) to this property.');
    addRow('matches', 'Matches', 'Write the number of matches to this property.');
    addRow('wins', 'Wins', 'Write the number of wins to this property.');

    const btns = new Setting(contentEl);
    btns.addButton((b) =>
      b.setButtonText('Cancel').onClick(() => {
        if (this.resolved) return;
        this.resolved = true;
        const r = this.resolver;
        this.resolver = undefined;
        r?.(undefined);
        this.close();
      }),
    );
    btns.addButton((b) =>
      b
        .setCta()
        .setButtonText(this.mode === 'create' ? 'Create cohort' : 'Save changes')
        .onClick(() => {
          if (this.resolved) return;
          const overrides = this.buildOverridesPayload();
          this.resolved = true;
          const r = this.resolver;
          this.resolver = undefined;
          r?.(overrides);
          this.close();
        }),
    );
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      const r = this.resolver;
      this.resolver = undefined;
      r?.(undefined);
    }
  }
}
