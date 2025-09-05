export type MatchResult = 'A' | 'B' | 'D';

export interface EloPlayer {
  rating: number;
  matches: number;
  wins: number;
}

export interface CohortData {
  players: Record<string, EloPlayer>;
}

export interface EloStore {
  version: number;
  cohorts: Record<string, CohortData>;
}

export interface PlayerSnapshot {
  path: string;
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
