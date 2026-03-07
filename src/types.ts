import type { FrontmatterPropertiesSettings, SessionReportConfig } from './settings';

export type MatchResult = 'A' | 'B' | 'D';

export interface Player {
  rating: number;
  matches: number;
  wins: number;
  sigma?: number;
  lastMatchAt?: number;
}

export interface CohortData {
  players: Record<string, Player>;
}

export type CohortKind =
  | 'vault:all'
  | 'folder'
  | 'folder-recursive'
  | 'tag:any'
  | 'tag:all'
  | 'manual'
  | 'base';

export type CohortParamsMap = {
  'vault:all': Record<string, never>;
  folder: { path: string };
  'folder-recursive': { path: string };
  'tag:any': { tags: string[] };
  'tag:all': { tags: string[] };
  manual: { paths: string[] };
  base: { baseId: string; view: string };
};

export type CohortParams<K extends CohortKind = CohortKind> = CohortParamsMap[K];

export type CohortSpec<K extends CohortKind = CohortKind> = {
  kind: K;
  params: CohortParamsMap[K];
};

export type ScrollStartMode = 'none' | 'after-frontmatter' | 'first-image' | 'first-heading';

type CohortDefBase<K extends CohortKind> = {
  key: string;
  kind: K;
  label?: string;
  params: CohortParamsMap[K];
  frontmatterOverrides?: Partial<FrontmatterPropertiesSettings>;
  scrollStart?: ScrollStartMode;
  syncScroll?: boolean;
  sessionReport?: SessionReportConfig;
  createdAt: number;
  updatedAt: number;
};

export type CohortDefinition = {
  [K in CohortKind]: CohortDefBase<K>;
}[CohortKind];

export interface GlickoStore {
  version: number;
  cohorts: Record<string, CohortData>;
  cohortDefs?: Record<string, CohortDefinition>;
  lastUsedCohortKey?: string;
}

export interface PlayerSnapshot {
  id: string;
  rating: number;
  matches: number;
  wins: number;
  sigma?: number;
  lastMatchAt?: number;
}

export interface UndoFrame {
  cohortKey: string;
  a: PlayerSnapshot;
  b: PlayerSnapshot;
  result: MatchResult;
  ts: number;
}

export interface SessionMatchData {
  cohortKey: string;
  matches: UndoFrame[];
  idToPath: Map<string, string>;
  fileCount: number;
  startedAt: number;
}
