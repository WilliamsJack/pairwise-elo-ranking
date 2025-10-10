import type { MatchmakingSettings } from '../../settings';
import type { TFile } from 'obsidian';
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
  rng: Rng = Math.random,
): number {
  if (!mm?.enabled || !mm.lowMatchesBias.enabled) {
    return randInt(rng, files.length);
  }
  const exp = Math.max(0, Math.min(3, mm.lowMatchesBias.exponent));
  const weights = files.map((f) => {
    const s = getStats(f);
    return 1 / Math.pow(1 + Math.max(0, s.matches), Math.max(0.0001, exp));
  });
  return weightedRandomIndex(weights, rng);
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
  if (files.length < 2) {
    return { leftIndex: -1, rightIndex: -1, pairSig: '' };
  }
  const aIdx = pickAnchorIndex(files, getStats, mm, rng);
  let bIdx = pickOpponentIndex(files, aIdx, getStats, mm, rng);

  // Avoid repeating the exact same pair if possible
  const currentSig = mkPairSig(files[aIdx].path, files[bIdx].path);
  if (lastPairSig === currentSig && files.length >= 3) {
    for (let guard = 0; guard < 10; guard++) {
      const alt = pickOpponentIndex(files, aIdx, getStats, mm, rng);
      if (alt !== bIdx) {
        const altSig = mkPairSig(files[aIdx].path, files[alt].path);
        if (altSig !== lastPairSig) {
          bIdx = alt;
          break;
        }
      }
    }
  }

  const swap = rng() < 0.5;
  const leftIndex = swap ? aIdx : bIdx;
  const rightIndex = swap ? bIdx : aIdx;
  const pair = mkPairSig(files[leftIndex].path, files[rightIndex].path);
  return { leftIndex, rightIndex, pairSig: pair };
}
