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

// Heuristics config
export interface EloHeuristicsSettings {
  provisional: {
    enabled: boolean;
    matches: number;   // First N matches use a higher K
    multiplier: number; // Multiplier on K during provisional phase
  };
  decay: {
    enabled: boolean;
    halfLife: number;  // Matches at which K is halved (via 1/(1+m/halfLife))
    minK: number;      // Lower bound on K
  };
  upsetBoost: {
    enabled: boolean;
    threshold: number; // Rating gap that qualifies as an upset
    multiplier: number; // K multiplier for upsets
  };
  drawGapBoost: {
    enabled: boolean;
    threshold: number;  // Rating gap where a draw is considered highly informative
    multiplier: number; // K multiplier for those draws
  };
}

export interface EloSettings {
  kFactor: number;
  showToasts: boolean;
  eloIdLocation: EloIdLocation;
  frontmatterProperties: FrontmatterPropertiesSettings;
  askForOverridesOnCohortCreation: boolean;
  heuristics: EloHeuristicsSettings;
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

  // Modest defaults; only provisional + upset boosts on by default.
  heuristics: {
    provisional: {
      enabled: true,
      matches: 10,
      multiplier: 2.0,
    },
    decay: {
      enabled: false,
      halfLife: 200,
      minK: 8,
    },
    upsetBoost: {
      enabled: true,
      threshold: 200,
      multiplier: 1.25,
    },
    drawGapBoost: {
      enabled: true,
      threshold: 300,
      multiplier: 1.25,
    },
  },
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
