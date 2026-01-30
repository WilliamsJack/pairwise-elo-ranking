import type { TFile } from 'obsidian';

import type { MatchmakingSettings } from '../../settings';
import { pairSig as mkPairSig } from '../../utils/pair';

export type RatingStats = { rating: number; matches: number };
export type Rng = () => number;

const randInt = (rng: Rng, highExclusive: number) => Math.floor(rng() * highExclusive);

function weightedRandomIndex(weights: number[], rng: Rng): number {
  let sum = 0;
  for (const w of weights) sum += Math.max(0, w);
  if (sum <= 0) return randInt(rng, weights.length);
  let r = rng() * sum;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

export function pickAnchorIndex(
  files: TFile[],
  getStats: (f: TFile) => RatingStats,
  mm?: MatchmakingSettings,
  lastPairSig?: string,
  rng: Rng = Math.random,
): number {
  const n = files.length;

  // Build the allowed pool, optionally excluding the last pair's paths when n >= 3
  const allowed: number[] = [];
  if (lastPairSig && n >= 3) {
    const [p1, p2] = lastPairSig.split('||');
    for (let i = 0; i < n; i++) {
      const path = files[i].path;
      if (path !== p1 && path !== p2) allowed.push(i);
    }
  } else {
    for (let i = 0; i < n; i++) allowed.push(i);
  }

  if (!mm?.enabled || !mm.lowMatchesBias.enabled) {
    return allowed[randInt(rng, allowed.length)];
  }
  const exp = Math.max(0, Math.min(3, mm.lowMatchesBias.exponent));
  const weights = allowed.map((i) => {
    const s = getStats(files[i]);
    return 1 / Math.pow(1 + Math.max(0, s.matches), Math.max(0.0001, exp));
  });
  const chosen = weightedRandomIndex(weights, rng);
  return allowed[chosen];
}

function reservoirSample(indices: number[], k: number, rng: Rng): number[] {
  const out: number[] = [];
  let seen = 0;
  for (const idx of indices) {
    seen++;
    if (out.length < k) {
      out.push(idx);
    } else {
      const j = randInt(rng, seen);
      if (j < k) out[j] = idx;
    }
  }
  return out;
}

export function pickOpponentIndex(
  files: TFile[],
  anchorIdx: number,
  getStats: (f: TFile) => RatingStats,
  mm?: MatchmakingSettings,
  rng: Rng = Math.random,
): number {
  const n = files.length;
  const pool: number[] = [];
  for (let i = 0; i < n; i++) if (i !== anchorIdx) pool.push(i);

  if (!mm?.enabled) {
    return pool[randInt(rng, pool.length)];
  }

  const anchor = getStats(files[anchorIdx]);

  const sampleSize = mm.similarRatings.enabled
    ? Math.max(2, Math.min(mm.similarRatings.sampleSize || 12, pool.length))
    : Math.max(1, Math.min(12, pool.length));

  const sample = reservoirSample(pool, sampleSize, rng);

  if (mm.upsetProbes.enabled && rng() < Math.max(0, Math.min(1, mm.upsetProbes.probability))) {
    const minGap = Math.max(0, Math.round(mm.upsetProbes.minGap || 0));
    let bestIdx = -1;
    let bestGap = -1;
    for (const j of sample) {
      const s = getStats(files[j]);
      const gap = Math.abs(s.rating - anchor.rating);
      if (gap >= minGap && gap > bestGap) {
        bestGap = gap;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0) return bestIdx;
  }

  if (mm.similarRatings.enabled) {
    let best = sample[0];
    let bestGap = Number.POSITIVE_INFINITY;
    let bestMatches = Number.POSITIVE_INFINITY;
    for (const j of sample) {
      const s = getStats(files[j]);
      const gap = Math.abs(s.rating - anchor.rating);
      if (gap < bestGap || (gap === bestGap && s.matches < bestMatches)) {
        best = j;
        bestGap = gap;
        bestMatches = s.matches;
      }
    }
    return best;
  }

  return sample[randInt(rng, sample.length)];
}

export function pickNextPairIndices(
  files: TFile[],
  getStats: (f: TFile) => RatingStats,
  mm?: MatchmakingSettings,
  lastPairSig?: string,
  rng: Rng = Math.random,
): { leftIndex: number; rightIndex: number; pairSig: string } {
  const n = files.length;
  if (n < 2) {
    return { leftIndex: -1, rightIndex: -1, pairSig: '' };
  }

  // Degenerate case: only two notes - just use them again
  if (n === 2) {
    const leftIndex = 0;
    const rightIndex = 1;
    const pair = mkPairSig(files[leftIndex].path, files[rightIndex].path);
    return { leftIndex, rightIndex, pairSig: pair };
  }

  // n >= 3: forbid either of the last pair as the next anchor (if we know it)
  const aIdx = pickAnchorIndex(files, getStats, mm, lastPairSig, rng);
  const bIdx = pickOpponentIndex(files, aIdx, getStats, mm, rng);

  const swap = rng() < 0.5;
  const leftIndex = swap ? aIdx : bIdx;
  const rightIndex = swap ? bIdx : aIdx;
  const pair = mkPairSig(files[leftIndex].path, files[rightIndex].path);
  return { leftIndex, rightIndex, pairSig: pair };
}
