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

// Heuristics config
export interface EloHeuristicsSettings {
  provisional: {
    enabled: boolean;
    matches: number; // First N matches use a higher K
    multiplier: number; // Multiplier on K during provisional phase
  };
  decay: {
    enabled: boolean;
    halfLife: number; // Matches at which K is halved (via 1/(1+m/halfLife))
    minK: number; // Lower bound on K
  };
  upsetBoost: {
    enabled: boolean;
    threshold: number; // Rating gap that qualifies as an upset
    multiplier: number; // K multiplier for upsets
  };
  drawGapBoost: {
    enabled: boolean;
    threshold: number; // Rating gap where a draw is considered highly informative
    multiplier: number; // K multiplier for those draws
  };
}

// Matchmaking (pair selection) settings
export interface MatchmakingSettings {
  enabled: boolean;
  similarRatings: {
    enabled: boolean;
    sampleSize: number; // Number of opponents sampled when picking by rating similarity
  };
  lowMatchesBias: {
    enabled: boolean;
    exponent: number; // Strength of bias towards fewer matches (0 = none, higher = stronger)
  };
  upsetProbes: {
    enabled: boolean;
    probability: number; // Chance to schedule a high-gap pair instead of similar ratings
    minGap: number; // Minimum rating gap to qualify as a probe
  };
}

export interface EloSettings {
  kFactor: number;
  showToasts: boolean;
  eloIdLocation: EloIdLocation;
  sessionLayout: SessionLayoutMode;
  frontmatterProperties: FrontmatterPropertiesSettings;
  askForOverridesOnCohortCreation: boolean;
  heuristics: EloHeuristicsSettings;
  matchmaking: MatchmakingSettings;
  templatesFolderPath: string;
}

export const DEFAULT_SETTINGS: EloSettings = {
  kFactor: 24,
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

  // Modest defaults; provisional + upset + big-gap draw boosts on by default.
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

  // Matchmaking heuristics defaults
  matchmaking: {
    enabled: true,
    similarRatings: {
      enabled: true,
      sampleSize: 12,
    },
    lowMatchesBias: {
      enabled: true,
      exponent: 1.0,
    },
    upsetProbes: {
      enabled: true,
      probability: 0.1,
      minGap: 300,
    },
  },

  templatesFolderPath: '',
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
