export type EloIdLocation = 'frontmatter' | 'end';

export interface FrontmatterPropertyConfig {
  property: string;
  enabled: boolean;
}

export interface FrontmatterPropertiesSettings {
  rating: FrontmatterPropertyConfig;
  rank: FrontmatterPropertyConfig;
  matches: FrontmatterPropertyConfig;
  wins: FrontmatterPropertyConfig;
}

export interface EloSettings {
  kFactor: number;
  showToasts: boolean;
  eloIdLocation: EloIdLocation;
  frontmatterProperties: FrontmatterPropertiesSettings;
}

export const DEFAULT_SETTINGS: EloSettings = {
  kFactor: 24,
  showToasts: true,
  eloIdLocation: 'frontmatter',
  frontmatterProperties: {
    rating:  { property: 'eloRating',   enabled: false },
    rank:    { property: 'eloRank',     enabled: false },
    matches: { property: 'eloMatches',  enabled: false },
    wins:    { property: 'eloWins',     enabled: false },
  },
};
