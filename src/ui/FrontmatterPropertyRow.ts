import { Setting, TextComponent, ToggleComponent } from 'obsidian';

export type FmPropKey = 'rating' | 'rank' | 'matches' | 'wins';
export const FM_PROP_KEYS: readonly FmPropKey[] = ['rating', 'rank', 'matches', 'wins'] as const;

type Meta = { label: string; desc: string };

const META: Record<FmPropKey, Meta> = {
  rating: {
    label: 'Rating',
    desc: 'Write the current Elo rating to this property.',
  },
  rank: {
    label: 'Rank',
    desc: 'Write the cohort rank (1 = highest) to this property.',
  },
  matches: {
    label: 'Matches',
    desc: 'Write the number of matches to this property.',
  },
  wins: {
    label: 'Wins',
    desc: 'Write the number of wins to this property.',
  },
};

export type FmRowValue = { enabled: boolean; property: string };
export type FmRowRefs = { setting: Setting; text: TextComponent; toggle: ToggleComponent };

export function renderStandardFmPropertyRow(
  parent: HTMLElement,
  key: FmPropKey,
  opts: {
    value: FmRowValue;
    base: FmRowValue; 
    onChange: (next: FmRowValue) => void | Promise<void>;
    showReset?: boolean;
  }
): FmRowRefs {
  const meta = META[key];
  const placeholder = opts.base.property || '';

  const cur: FmRowValue = {
    enabled: !!opts.value.enabled,
    property: opts.value.property ?? '',
  };

  let textRef!: TextComponent;
  let toggleRef!: ToggleComponent;

  const setting = new Setting(parent)
    .setName(meta.label)
    .setDesc(meta.desc)
    .addToggle((t) => {
      toggleRef = t;
      t.setValue(cur.enabled).onChange((v) => {
        cur.enabled = !!v;
        textRef?.setDisabled(!cur.enabled);
        void opts.onChange({ ...cur });
      });
    })
    .addText((t) => {
      textRef = t;
      t.setPlaceholder(placeholder)
        .setValue(cur.property)
        .setDisabled(!cur.enabled)
        .onChange((v) => {
          const trimmed = (v ?? '').trim();
          cur.property = trimmed.length > 0 ? trimmed : placeholder;
          void opts.onChange({ ...cur });
        });
    });

  if (opts.showReset) {
    setting.addButton((b) =>
      b
        .setButtonText('Reset')
        .setTooltip('Reset to global default')
        .onClick(() => {
          cur.enabled = !!opts.base.enabled;
          cur.property = opts.base.property || placeholder;
          toggleRef.setValue(cur.enabled);
          textRef.setValue(cur.property).setDisabled(!cur.enabled);
          void opts.onChange({ ...cur });
        })
    );
  }

  return { setting, text: textRef, toggle: toggleRef };
}
