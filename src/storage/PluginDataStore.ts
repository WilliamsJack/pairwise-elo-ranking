import {
  CohortData,
  EloStore,
  MatchResult,
  PlayerSnapshot,
  UndoFrame,
} from '../types';
import { DEFAULT_SETTINGS, EloSettings } from '../settings/settings';

import { Plugin } from 'obsidian';
import { updateElo } from '../domain/elo/EloEngine';

interface PersistedData {
  version: number;
  settings: EloSettings;
  store: EloStore;
}

const DEFAULT_STORE: EloStore = {
  version: 1,
  cohorts: {},
};

export class PluginDataStore {
  private plugin: Plugin;

  settings: EloSettings = { ...DEFAULT_SETTINGS };
  store: EloStore = { ...DEFAULT_STORE };

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async load(): Promise<void> {
    const raw = (await this.plugin.loadData()) as PersistedData | null;

    this.settings = raw?.settings ?? { ...DEFAULT_SETTINGS };
    this.store = raw?.store ?? { ...DEFAULT_STORE };

    if (!raw?.settings || !raw?.store) {
      await this.saveAll();
    }
  }

  async saveAll(): Promise<void> {
    const payload: PersistedData = {
      version: 1,
      settings: this.settings,
      store: this.store,
    };
    await this.plugin.saveData(payload);
  }

  async saveSettings(): Promise<void> {
    await this.saveAll();
  }

  async saveStore(): Promise<void> {
    await this.saveAll();
  }

  ensurePlayer(cohortKey: string, path: string) {
    const cohort = (this.store.cohorts[cohortKey] ??= { players: {} } as CohortData);
    const player = (cohort.players[path] ??= { rating: 1500, matches: 0, wins: 0 });
    return { cohort, player };
  }

  applyMatch(
    cohortKey: string,
    aPath: string,
    bPath: string,
    result: MatchResult
  ): { winnerPath?: string; undo: UndoFrame } {
    const cohort = (this.store.cohorts[cohortKey] ??= { players: {} });

    const a = (cohort.players[aPath] ??= { rating: 1500, matches: 0, wins: 0 });
    const b = (cohort.players[bPath] ??= { rating: 1500, matches: 0, wins: 0 });

    const undo: UndoFrame = {
      cohortKey,
      a: snapshot(aPath, a.rating, a.matches, a.wins),
      b: snapshot(bPath, b.rating, b.matches, b.wins),
      result,
      ts: Date.now(),
    };

    const { newA, newB } = updateElo(a.rating, b.rating, result, this.settings.kFactor);
    a.rating = newA;
    b.rating = newB;

    a.matches += 1;
    b.matches += 1;
    if (result === 'A') a.wins += 1;
    if (result === 'B') b.wins += 1;

    const winnerPath = result === 'A' ? aPath : result === 'B' ? bPath : undefined;
    return { winnerPath, undo };
  }

  revert(frame: UndoFrame): boolean {
    const cohort = this.store.cohorts[frame.cohortKey];
    if (!cohort) return false;

    const a = cohort.players[frame.a.path];
    const b = cohort.players[frame.b.path];
    if (!a || !b) return false;

    a.rating = frame.a.rating;
    a.matches = frame.a.matches;
    a.wins = frame.a.wins;

    b.rating = frame.b.rating;
    b.matches = frame.b.matches;
    b.wins = frame.b.wins;

    return true;
  }
}

function snapshot(path: string, rating: number, matches: number, wins: number): PlayerSnapshot {
  return { path, rating, matches, wins };
}
