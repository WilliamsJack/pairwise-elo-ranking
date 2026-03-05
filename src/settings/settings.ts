export type EloIdLocation = 'frontmatter' | 'end';
export type SessionLayoutMode = 'reuse-active' | 'right-split' | 'new-tab' | 'new-window';

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
  showToasts: boolean;
  eloIdLocation: EloIdLocation;
  sessionLayout: SessionLayoutMode;
  frontmatterProperties: FrontmatterPropertiesSettings;
  askForOverridesOnCohortCreation: boolean;
  stabilityThreshold: number;
  surpriseJitter: boolean;
  templatesFolderPath: string;
  debugLogging: boolean;
}

export const DEFAULT_SETTINGS: EloSettings = {
  showToasts: true,
  eloIdLocation: 'frontmatter',
  sessionLayout: 'new-tab',
  frontmatterProperties: {
    rating: { property: 'eloRating', enabled: false },
    rank: { property: 'eloRank', enabled: false },
    matches: { property: 'eloMatches', enabled: false },
    wins: { property: 'eloWins', enabled: false },
  },
  askForOverridesOnCohortCreation: true,

  stabilityThreshold: 150,
  surpriseJitter: true,

  templatesFolderPath: '',
  debugLogging: false,
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
