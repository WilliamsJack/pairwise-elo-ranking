export type EloIdLocation = 'frontmatter' | 'end';

export interface EloSettings {
  kFactor: number;
  showToasts: boolean;
  eloIdLocation: EloIdLocation;
}

export const DEFAULT_SETTINGS: EloSettings = {
  kFactor: 24,
  showToasts: true,
  eloIdLocation: 'frontmatter',
};
