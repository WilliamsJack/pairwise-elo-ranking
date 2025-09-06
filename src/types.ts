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

export interface CohortDefinition {
  key: string;
  kind: CohortKind;
  label?: string;
  // Params vary by kind:
  // - vault:all {}
  // - folder { path: string }
  // - folder-recursive { path: string }
  // - tag:any { tags: string[] }
  // - tag:all { tags: string[] }
  // - manual { paths: string[] }
  // - base { baseId: string; view?: string }
  params: any;
  createdAt: number;
  updatedAt: number;
}

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
