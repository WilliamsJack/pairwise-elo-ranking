import type { TFile } from 'obsidian';

import { DEFAULT_SIGMA } from '../rating/GlickoEngine';
import type { ScoredPlayer } from './InfoGain';
import { pickMaxInfoGainPair } from './InfoGain';

export type RatingStats = { rating: number; sigma?: number };

export function pickNextPairIndices(
  files: TFile[],
  getStats: (f: TFile) => RatingStats,
  lastPair?: [string, string],
  rng: () => number = Math.random,
): { leftIndex: number; rightIndex: number } {
  const n = files.length;
  if (n < 2) return { leftIndex: -1, rightIndex: -1 };

  if (n === 2) {
    return { leftIndex: 0, rightIndex: 1 };
  }

  let lastPairIndices: [number, number] | undefined;
  if (lastPair) {
    const i1 = files.findIndex((f) => f.path === lastPair[0]);
    const i2 = files.findIndex((f) => f.path === lastPair[1]);
    if (i1 >= 0 && i2 >= 0) lastPairIndices = [i1, i2];
  }

  const players: ScoredPlayer[] = files.map((f, i) => {
    const s = getStats(f);
    return { index: i, rating: s.rating, sigma: s.sigma ?? DEFAULT_SIGMA };
  });

  const result = pickMaxInfoGainPair(players, rng, { lastPairIndices });
  if (result) {
    return { leftIndex: result.leftIndex, rightIndex: result.rightIndex };
  }

  // Unreachable for n >= 2, but satisfy the return type
  return { leftIndex: -1, rightIndex: -1 };
}
