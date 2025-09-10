import type { FrontmatterPropertiesSettings } from './settings';

export type MatchResult = 'A' | 'B' | 'D';

export interface EloPlayer {
  rating: number;
  matches: number;
  wins: number;
}

export interface CohortData {
  players: Record<string, EloPlayer>;
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
  'folder': { path: string };
  'folder-recursive': { path: string };
  'tag:any': { tags: string[] };
  'tag:all': { tags: string[] };
  'manual': { paths: string[] };
  'base': { baseId: string; view?: string };
};

export type CohortParams<K extends CohortKind = CohortKind> = CohortParamsMap[K];

export type CohortSpec<K extends CohortKind = CohortKind> = {
  kind: K;
  params: CohortParamsMap[K];
};

type CohortDefBase<K extends CohortKind> = {
  key: string;
  kind: K;
  label?: string;
  params: CohortParamsMap[K];
  frontmatterOverrides?: Partial<FrontmatterPropertiesSettings>;
  createdAt: number;
  updatedAt: number;
};

export type CohortDefinition = {
  [K in CohortKind]: CohortDefBase<K>
}[CohortKind];

export interface EloStore {
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
}

export interface UndoFrame {
  cohortKey: string;
  a: PlayerSnapshot;
  b: PlayerSnapshot;
  result: MatchResult;
  ts: number;
}
