import { MatchResult } from '../../types';
import type { EloHeuristicsSettings as EloHeuristics } from '../../settings';

export function expectedScore(rA: number, rB: number): number {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function kFromMatches(baseK: number, matches: number, decay?: EloHeuristics['decay']): number {
  if (!decay?.enabled) return baseK;

  const halfLife = Math.max(1, Math.round(decay.halfLife ?? 200));
  let minK = Math.max(1, Math.round(decay.minK ?? 8));
  minK = Math.min(minK, baseK);

  // Hyperbolic decay with half-life:
  // factor = 1 / (1 + matches / halfLife)
  const factor = 1 / (1 + matches / halfLife);
  const k = baseK * factor;
  return Math.max(minK, k);
}

function applyProvisionalBoost(k: number, matches: number, prov?: EloHeuristics['provisional']): number {
  if (!prov?.enabled) return k;
  const n = Math.max(1, Math.round(prov.matches ?? 10));
  const mult = clamp(prov.multiplier ?? 2.0, 1.0, 5.0);
  return matches < n ? k * mult : k;
}

function applyOutcomeBoosts(
  kA: number,
  kB: number,
  rA: number,
  rB: number,
  result: MatchResult,
  upset?: EloHeuristics['upsetBoost'],
  drawGap?: EloHeuristics['drawGapBoost'],
): { kA: number; kB: number } {
  const gap = Math.abs(rA - rB);

  // Upset boost: multiply K if the lower-rated note wins by a decent margin.
  if (upset?.enabled) {
    const th = Math.max(0, Math.round(upset.threshold ?? 200));
    const mult = clamp(upset.multiplier ?? 1.25, 1.0, 3.0);
    const underdogAWins = rA < rB && result === 'A';
    const underdogBWins = rB < rA && result === 'B';
    if (gap >= th && (underdogAWins || underdogBWins)) {
      kA *= mult;
      kB *= mult;
    }
  }

  // Draw gap boost: a draw with a big gap is informative; move faster.
  if (drawGap?.enabled && result === 'D') {
    const th = Math.max(0, Math.round(drawGap.threshold ?? 300));
    const mult = clamp(drawGap.multiplier ?? 1.25, 1.0, 3.0);
    if (gap >= th) {
      kA *= mult;
      kB *= mult;
    }
  }

  return { kA, kB };
}

/**
 * Advanced Elo update that supports per-player effective K, provisional boosts,
 * simple K decay with experience, and upset/draw gap boosts. If all options
 * are disabled or omitted, this reduces to classic Elo with constant K.
 */
export function updateElo(
  rA: number,
  rB: number,
  result: MatchResult,
  baseK: number,
  aMatches: number,
  bMatches: number,
  heuristics?: EloHeuristics,
): { newA: number; newB: number; kA: number; kB: number; eA: number } {
  // Per-player K from decay + provisional boost
  let kA = kFromMatches(baseK, aMatches, heuristics?.decay);
  let kB = kFromMatches(baseK, bMatches, heuristics?.decay);

  kA = applyProvisionalBoost(kA, aMatches, heuristics?.provisional);
  kB = applyProvisionalBoost(kB, bMatches, heuristics?.provisional);

  // Outcome-based multipliers (upsets and big-gap draws)
  const boosted = applyOutcomeBoosts(kA, kB, rA, rB, result, heuristics?.upsetBoost, heuristics?.drawGapBoost);
  kA = boosted.kA;
  kB = boosted.kB;

  // Classic Elo update but with kA/kB
  const eA = expectedScore(rA, rB);
  const sA = result === 'A' ? 1 : result === 'D' ? 0.5 : 0;
  const sB = 1 - sA;
  const eB = 1 - eA;

  const newA = rA + kA * (sA - eA);
  const newB = rB + kB * (sB - eB);

  return { newA, newB, kA, kB, eA };
}
