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
  askForOverridesOnCohortCreation: boolean;
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
  askForOverridesOnCohortCreation: true,
};

// Merge global defaults with optional overrides (per-property)
export function effectiveFrontmatterProperties(
  base: FrontmatterPropertiesSettings,
  overrides?: Partial<FrontmatterPropertiesSettings>,
): FrontmatterPropertiesSettings {
  return {
    rating: overrides?.rating ?? base.rating,
    rank: overrides?.rank ?? base.rank,
    matches: overrides?.matches ?? base.matches,
    wins: overrides?.wins ?? base.wins,
  };
}
