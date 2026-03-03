/**
 * Information-gain matchmaker
 *
 * Tracks per-player uncertainty (sigma) and picks the pair whose comparison
 * would most reduce overall ranking uncertainty.
 */

import { expectedScore } from '../elo/EloEngine';

export const DEFAULT_SIGMA = 350;
export const MIN_SIGMA = 30;

export interface ScoredPlayer {
  index: number;
  rating: number;
  sigma: number;
}

type Rng = () => number;

// ---- Glicko helpers ----

const Q = Math.log(10) / 400;

// Glicko g-function: dampens the influence of an opponent's uncertainty.
export function gSigma(sigma: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * sigma * sigma) / (Math.PI * Math.PI));
}

// Outcome-independent uncertainty (sigma) update for one player after a single comparison.
export function updateSigma(rI: number, rJ: number, sigmaI: number, sigmaJ: number): number {
  const g = gSigma(sigmaJ);
  const E = 1 / (1 + Math.pow(10, (-g * (rI - rJ)) / 400));
  const dSq = 1 / (Q * Q * g * g * E * (1 - E));
  const newSigma = 1 / Math.sqrt(1 / (sigmaI * sigmaI) + 1 / dSq);
  return Math.max(MIN_SIGMA, Math.min(DEFAULT_SIGMA, newSigma));
}

// ---- Information gain ----

// Expected information gain from comparing players i and j.
// IG = (sigma_i^2 + sigma_j^2) * p * (1 - p)
function informationGain(rI: number, rJ: number, sigmaI: number, sigmaJ: number): number {
  const p = expectedScore(rI, rJ);
  return (sigmaI * sigmaI + sigmaJ * sigmaJ) * p * (1 - p);
}

/**
 * ---- Pair picker ----
 *
 * Pick the pair with the highest expected information gain.
 *
 * For small cohorts (n <= 1000) all pairs are enumerated.
 * For larger cohorts, random pairs are sampled.
 *
 * Ties are broken via reservoir sampling.
 */

const ENUMERATE_THRESHOLD = 1000;
const SAMPLE_PAIRS = 20_000;

export function pickMaxInfoGainPair(
  players: ScoredPlayer[],
  rng: Rng = Math.random,
  opts?: { lastPairIndices?: [number, number] },
): { leftIndex: number; rightIndex: number } | null {
  const n = players.length;
  if (n < 2) return null;
  if (n === 2) return { leftIndex: players[0].index, rightIndex: players[1].index };

  const lastA = opts?.lastPairIndices?.[0] ?? -1;
  const lastB = opts?.lastPairIndices?.[1] ?? -1;

  const isLastPair = (a: number, b: number): boolean =>
    (a === lastA && b === lastB) || (a === lastB && b === lastA);

  let bestIG = -1;
  let bestA = -1;
  let bestB = -1;
  let tieCount = 0;

  const consider = (pi: ScoredPlayer, pj: ScoredPlayer) => {
    if (isLastPair(pi.index, pj.index)) return;
    const ig = informationGain(pi.rating, pj.rating, pi.sigma, pj.sigma);
    if (ig > bestIG) {
      bestIG = ig;
      bestA = pi.index;
      bestB = pj.index;
      tieCount = 1;
    } else if (ig === bestIG) {
      tieCount++;
      if (rng() < 1 / tieCount) {
        bestA = pi.index;
        bestB = pj.index;
      }
    }
  };

  if (n <= ENUMERATE_THRESHOLD) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        consider(players[i], players[j]);
      }
    }
  } else {
    for (let s = 0; s < SAMPLE_PAIRS; s++) {
      const i = Math.floor(rng() * n);
      let j = Math.floor(rng() * (n - 1));
      if (j >= i) j++;
      consider(players[i], players[j]);
    }
  }

  // Fallback: if every pair was the last pair (n=3 edge case)
  if (bestA < 0) {
    bestA = players[0].index;
    bestB = players[1].index;
  }

  // Random side assignment
  if (rng() < 0.5) return { leftIndex: bestA, rightIndex: bestB };
  return { leftIndex: bestB, rightIndex: bestA };
}
