import type { TFile } from 'obsidian';

import { pairSig as mkPairSig } from '../../utils/pair';
import { DEFAULT_SIGMA } from '../rating/GlickoEngine';
import type { ScoredPlayer } from './InfoGain';
import { pickMaxInfoGainPair } from './InfoGain';

export type RatingStats = { rating: number; sigma?: number };

export function pickNextPairIndices(
  files: TFile[],
  getStats: (f: TFile) => RatingStats,
  lastPairSig?: string,
  rng: () => number = Math.random,
): { leftIndex: number; rightIndex: number; pairSig: string } {
  const n = files.length;
  if (n < 2) return { leftIndex: -1, rightIndex: -1, pairSig: '' };

  if (n === 2) {
    const pair = mkPairSig(files[0].path, files[1].path);
    return { leftIndex: 0, rightIndex: 1, pairSig: pair };
  }

  let lastPairIndices: [number, number] | undefined;
  if (lastPairSig) {
    const [p1, p2] = lastPairSig.split('||');
    const i1 = files.findIndex((f) => f.path === p1);
    const i2 = files.findIndex((f) => f.path === p2);
    if (i1 >= 0 && i2 >= 0) lastPairIndices = [i1, i2];
  }

  const players: ScoredPlayer[] = files.map((f, i) => {
    const s = getStats(f);
    return { index: i, rating: s.rating, sigma: s.sigma ?? DEFAULT_SIGMA };
  });

  const result = pickMaxInfoGainPair(players, rng, { lastPairIndices });
  if (result) {
    const pair = mkPairSig(files[result.leftIndex].path, files[result.rightIndex].path);
    return { leftIndex: result.leftIndex, rightIndex: result.rightIndex, pairSig: pair };
  }

  // Unreachable for n >= 2, but satisfy the return type
  return { leftIndex: -1, rightIndex: -1, pairSig: '' };
}
