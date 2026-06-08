export type IdLocation = 'frontmatter' | 'end';
export type SessionLayoutMode = 'reuse-active' | 'right-split' | 'new-tab' | 'new-window';

export interface FrontmatterPropertyConfig {
  property: string;
  enabled: boolean;
}

// How a note's star value is derived from the cohort's pairwise results.
// - 'rating': min-max normalise the Glicko rating between the lowest and
//   highest rated notes (preserves the size of rating gaps).
// - 'rank': spread notes evenly across the scale by rank position.
export type StarMapping = 'rating' | 'rank';

export interface StarScaleConfig {
  enabled: boolean;
  property: string;
  max: number;
  allowZero: boolean;
  mode: 'integer' | 'float';
  decimals: number; // decimal places used when mode === 'float'
  mapping: StarMapping;
}

export interface FrontmatterPropertiesSettings {
  rating: FrontmatterPropertyConfig;
  uncertainty: FrontmatterPropertyConfig;
  rank: FrontmatterPropertyConfig;
  matches: FrontmatterPropertyConfig;
  wins: FrontmatterPropertyConfig;
  stars: StarScaleConfig;
}

export interface SessionReportConfig {
  enabled: boolean;
  folderPath: string;
  nameTemplate: string;
  reportTemplatePath?: string;
}

export interface GlickoSettings {
  showToasts: boolean;
  idPropertyName: string;
  idLocation: IdLocation;
  sessionLayout: SessionLayoutMode;
  frontmatterProperties: FrontmatterPropertiesSettings;
  askForOverridesOnCohortCreation: boolean;
  askForReportSettingsOnCreation: boolean;
  stabilityThreshold: number;
  surpriseJitter: boolean;
  templatesFolderPath: string;
  debugLogging: boolean;
  sessionReport: SessionReportConfig;
}

export const DEFAULT_SETTINGS: GlickoSettings = {
  showToasts: true,
  idPropertyName: 'glickoId',
  idLocation: 'frontmatter',
  sessionLayout: 'new-tab',
  frontmatterProperties: {
    rating: { property: 'glickoRating', enabled: false },
    uncertainty: { property: 'glickoUncertainty', enabled: false },
    rank: { property: 'glickoRank', enabled: false },
    matches: { property: 'glickoMatches', enabled: false },
    wins: { property: 'glickoWins', enabled: false },
    stars: {
      enabled: false,
      property: 'stars',
      max: 7,
      allowZero: false,
      mode: 'integer',
      decimals: 1,
      mapping: 'rating',
    },
  },
  askForOverridesOnCohortCreation: true,
  askForReportSettingsOnCreation: true,

  stabilityThreshold: 150,
  surpriseJitter: true,

  templatesFolderPath: '',
  debugLogging: false,
  sessionReport: {
    enabled: false,
    folderPath: 'Glicko Reports',
    nameTemplate: '{{cohort}} post-session report - {{datetime}}',
  },
};

// Merge global defaults with optional overrides (per-property)
export function effectiveFrontmatterProperties(
  base: FrontmatterPropertiesSettings,
  overrides?: Partial<FrontmatterPropertiesSettings>,
): FrontmatterPropertiesSettings {
  return {
    rating: overrides?.rating ?? base.rating,
    uncertainty: overrides?.uncertainty ?? base.uncertainty,
    rank: overrides?.rank ?? base.rank,
    matches: overrides?.matches ?? base.matches,
    wins: overrides?.wins ?? base.wins,
    stars: overrides?.stars ?? base.stars,
  };
}

// Used to decide whether a change warrants rewriting cohort frontmatter.
export function starScaleConfigEquals(a: StarScaleConfig, b: StarScaleConfig): boolean {
  return (
    a.enabled === b.enabled &&
    a.property.trim() === b.property.trim() &&
    a.max === b.max &&
    a.allowZero === b.allowZero &&
    a.mode === b.mode &&
    a.decimals === b.decimals &&
    a.mapping === b.mapping
  );
}
