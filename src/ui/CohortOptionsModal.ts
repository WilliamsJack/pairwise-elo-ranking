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

export type CohortOptionsResult = {
  overrides: Partial<FrontmatterPropertiesSettings>;
  name?: string;
};

export class CohortOptionsModal extends Modal {
  private plugin: EloPlugin;
  private resolver?: (res?: CohortOptionsResult) => void;
  private resolved = false;

  private mode: Mode;
  private base: FrontmatterPropertiesSettings;
  private initial?: Partial<FrontmatterPropertiesSettings>;
  private initialName?: string;

  private nameWorking: string = '';

  private working: Record<Key, RowState>;

  constructor(
    app: App,
    plugin: EloPlugin,
    opts?: { mode?: Mode; initial?: Partial<FrontmatterPropertiesSettings>; initialName?: string },
  ) {
    super(app);
    this.plugin = plugin;
    this.mode = opts?.mode ?? 'create';
    this.base = plugin.settings.frontmatterProperties;
    this.initial = opts?.initial;
    this.initialName = (opts?.initialName ?? '').trim();
    this.nameWorking = this.initialName ?? '';

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
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.open();
    });
  }

  private resetRowToDefault(row: RowState, textRef?: TextComponent, toggleRef?: ToggleComponent) {
    const baseCfg = this.base[row.key];
    row.enabled = baseCfg.enabled;
    row.property = baseCfg.property;
    row.overridden = false;
    if (toggleRef) toggleRef.setValue(row.enabled);
    if (textRef) {
      textRef.setValue(row.property);
      textRef.setDisabled(!row.enabled);
    }
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
        (out as any)[key] = { property: row.property.trim(), enabled: !!row.enabled } as FrontmatterPropertyConfig;
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
      .setDesc('Shown in menus. Optional — leave blank to use an automatic description.')
      .addText((t) =>
        t
          .setPlaceholder('e.g. My Reading List')
          .setValue(this.nameWorking)
          .onChange((v) => {
            this.nameWorking = (v ?? '').trim();
          }),
      );

    const addRow = (key: Key, label: string, help: string) => {
      const row = this.working[key];
      let textRef: TextComponent | undefined;
      let toggleRef: ToggleComponent | undefined;

      const s = new Setting(contentEl)
        .setName(label)
        .setDesc(help)
        .addToggle((t: ToggleComponent) => {
          toggleRef = t;
          t.setValue(Boolean(row.enabled)).onChange((val) => {
            row.enabled = val;
            if (textRef) textRef.setDisabled(!val);
            this.updateOverriddenFlag(row);
          });
        })
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

      s.addButton((b: ButtonComponent) =>
        b
          .setButtonText('Reset')
          .setTooltip('Reset to global default')
          .onClick(() => this.resetRowToDefault(row, textRef, toggleRef)),
      );
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
          const result: CohortOptionsResult = {
            overrides: this.buildOverridesPayload(),
            name: this.nameWorking || undefined,
          };
          this.resolved = true;
          const r = this.resolver;
          this.resolver = undefined;
          r?.(result);
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
