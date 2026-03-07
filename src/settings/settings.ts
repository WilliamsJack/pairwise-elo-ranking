export type IdLocation = 'frontmatter' | 'end';
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
    rank: { property: 'glickoRank', enabled: false },
    matches: { property: 'glickoMatches', enabled: false },
    wins: { property: 'glickoWins', enabled: false },
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
    rank: overrides?.rank ?? base.rank,
    matches: overrides?.matches ?? base.matches,
    wins: overrides?.wins ?? base.wins,
  };
}
