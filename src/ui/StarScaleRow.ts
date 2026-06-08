import { Setting } from 'obsidian';

import type { StarScaleConfig } from '../settings';
import { DEFAULT_SETTINGS } from '../settings';
import {
  FM_STARS_COPY,
  PROPERTY_NAME_LABEL,
  STAR_MAPPING_LABELS,
  STAR_MODE_LABELS,
} from '../settings/frontmatterCopy';

type RowMode = 'global' | 'cohort';

// Imperatively render the Star rating configuration for the per-cohort options modal.
// The global settings page renders the equivalent controls declaratively.
export function renderStarScaleSettings(
  parent: HTMLElement,
  opts: {
    value: StarScaleConfig;
    base: StarScaleConfig;
    mode?: RowMode;
    onChange: (next: StarScaleConfig) => void | Promise<void>;
  },
): void {
  const mode: RowMode = opts.mode ?? 'cohort';
  const cur: StarScaleConfig = { ...opts.value };
  const emit = () => void opts.onChange({ ...cur });

  const defaultProp = opts.base.property || DEFAULT_SETTINGS.frontmatterProperties.stars.property;

  const dependents: Setting[] = [];

  const enableSetting = new Setting(parent)
    .setName(FM_STARS_COPY.label)
    .setDesc(FM_STARS_COPY.toggleDesc)
    .addToggle((t) =>
      t.setValue(cur.enabled).onChange((v) => {
        cur.enabled = !!v;
        refreshControls();
        emit();
      }),
    );

  if (mode === 'cohort') {
    enableSetting.addExtraButton((b) =>
      b
        .setIcon('reset')
        .setTooltip('Reset to global default')
        .onClick(() => {
          Object.assign(cur, opts.base);
          rerender();
          emit();
        }),
    );
  }

  const propSetting = new Setting(parent)
    .setName(PROPERTY_NAME_LABEL)
    .setDesc(FM_STARS_COPY.nameDesc)
    .addText((t) =>
      t
        .setPlaceholder(defaultProp)
        .setValue(cur.property)
        .onChange((v) => {
          const trimmed = (v ?? '').trim();
          cur.property = trimmed.length > 0 ? trimmed : defaultProp;
          emit();
        }),
    );
  dependents.push(propSetting);

  const maxSetting = new Setting(parent)
    .setName(FM_STARS_COPY.fields.max.name)
    .setDesc(FM_STARS_COPY.fields.max.desc)
    .addText((t) => {
      t.inputEl.type = 'number';
      t.inputEl.min = '2';
      t.setValue(String(cur.max)).onChange((v) => {
        const n = Math.round(Number(v));
        if (Number.isFinite(n) && n >= 2) {
          cur.max = n;
          emit();
        }
      });
    });
  dependents.push(maxSetting);

  const allowZeroSetting = new Setting(parent)
    .setName(FM_STARS_COPY.fields.allowZero.name)
    .setDesc(FM_STARS_COPY.fields.allowZero.desc)
    .addToggle((t) =>
      t.setValue(cur.allowZero).onChange((v) => {
        cur.allowZero = !!v;
        emit();
      }),
    );
  dependents.push(allowZeroSetting);

  const modeSetting = new Setting(parent)
    .setName(FM_STARS_COPY.fields.mode.name)
    .setDesc(FM_STARS_COPY.fields.mode.desc)
    .addDropdown((dd) =>
      dd
        .addOptions(STAR_MODE_LABELS)
        .setValue(cur.mode)
        .onChange((v) => {
          cur.mode = v === 'float' ? 'float' : 'integer';
          refreshDecimalsVisibility();
          emit();
        }),
    );
  dependents.push(modeSetting);

  const decimalsSetting = new Setting(parent)
    .setName(FM_STARS_COPY.fields.decimals.name)
    .setDesc(FM_STARS_COPY.fields.decimals.desc)
    .addText((t) => {
      t.inputEl.type = 'number';
      t.inputEl.min = '1';
      t.inputEl.max = '2';
      t.setValue(String(cur.decimals === 2 ? 2 : 1)).onChange((v) => {
        const n = Math.round(Number(v));
        if (n === 1 || n === 2) {
          cur.decimals = n;
          emit();
        }
      });
    });
  dependents.push(decimalsSetting);

  const mappingSetting = new Setting(parent)
    .setName(FM_STARS_COPY.fields.mapping.name)
    .setDesc(FM_STARS_COPY.fields.mapping.desc)
    .addDropdown((dd) =>
      dd
        .addOptions(STAR_MAPPING_LABELS)
        .setValue(cur.mapping)
        .onChange((v) => {
          cur.mapping = v === 'rank' ? 'rank' : 'rating';
          emit();
        }),
    );
  dependents.push(mappingSetting);

  refreshControls();

  function refreshControls() {
    for (const s of dependents) {
      if (mode === 'cohort') {
        s.settingEl.toggle(cur.enabled);
      } else {
        s.setDisabled(!cur.enabled);
      }
    }
    refreshDecimalsVisibility();
  }

  function refreshDecimalsVisibility() {
    decimalsSetting.settingEl.toggle(cur.enabled && cur.mode === 'float');
  }

  function rerender() {
    enableSetting.settingEl.remove();
    for (const s of dependents) s.settingEl.remove();
    renderStarScaleSettings(parent, { ...opts, value: { ...cur } });
  }
}
