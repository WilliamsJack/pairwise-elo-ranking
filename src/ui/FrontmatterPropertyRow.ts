import type { TextComponent, ToggleComponent } from 'obsidian';
import { Setting } from 'obsidian';

import type { FmSimpleKey } from '../settings/frontmatterCopy';
import { FM_SIMPLE_COPY, FM_SIMPLE_KEYS } from '../settings/frontmatterCopy';

export type FmPropKey = FmSimpleKey;
export const FM_PROP_KEYS = FM_SIMPLE_KEYS;

export type FmRowValue = { enabled: boolean; property: string };
export type FmRowRefs = { setting: Setting; text: TextComponent; toggle: ToggleComponent };

type RowMode = 'global' | 'cohort';

export function renderStandardFmPropertyRow(
  parent: HTMLElement,
  key: FmPropKey,
  opts: {
    value: FmRowValue;
    base: FmRowValue;
    onChange: (next: FmRowValue) => void | Promise<void>;
    mode?: RowMode;
  },
): FmRowRefs {
  const copy = FM_SIMPLE_COPY[key];
  const placeholder = opts.base.property || '';
  const mode: RowMode = opts.mode ?? 'cohort';

  const cur: FmRowValue = {
    enabled: !!opts.value.enabled,
    property: opts.value.property ?? '',
  };

  let textRef!: TextComponent;
  let toggleRef!: ToggleComponent;

  const setting = new Setting(parent)
    .setName(copy.label)
    .setDesc(copy.toggleDesc)
    .addToggle((t) => {
      toggleRef = t;
      t.setValue(cur.enabled).onChange((v) => {
        cur.enabled = !!v;
        if (mode === 'cohort') {
          textRef.setDisabled(!cur.enabled);
        }
        void opts.onChange({ ...cur });
      });
    })
    .addText((t) => {
      textRef = t;
      t.setPlaceholder(placeholder)
        .setValue(cur.property)
        .setDisabled(mode === 'cohort' ? !cur.enabled : false)
        .onChange((v) => {
          const trimmed = (v ?? '').trim();
          cur.property = trimmed.length > 0 ? trimmed : placeholder;
          void opts.onChange({ ...cur });
        });
    });

  if (mode === 'cohort') {
    setting.addExtraButton((b) =>
      b
        .setIcon('reset')
        .setTooltip('Reset to global default')
        .onClick(() => {
          cur.enabled = !!opts.base.enabled;
          cur.property = opts.base.property || placeholder;
          toggleRef.setValue(cur.enabled);
          textRef.setValue(cur.property).setDisabled(!cur.enabled);
          void opts.onChange({ ...cur });
        }),
    );
  }

  return { setting, text: textRef, toggle: toggleRef };
}
