export const DEFAULT_SIGMA = 350;
export const MIN_SIGMA = 30;

const Q = Math.log(10) / 400;

export function expectedScore(rA: number, rB: number): number {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

// Glicko g-function: dampens the influence of an opponent's uncertainty.
export function gSigma(sigma: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * sigma * sigma) / (Math.PI * Math.PI));
}

/**
 * Glicko-1 RD inflation.
 *
 * σ_new = min(cap, sqrt(σ^2 + c^2 × t))
 * where t = elapsed days, c = sqrt((cap^2 - MIN_SIGMA^2) / T_MAX).
 * T_MAX = 90 days (full inflation back to cap after 3 months of inactivity).
 */
const T_MAX_DAYS = 90;
const MS_PER_DAY = 86_400_000;

export function inflateSigma(sigma: number, elapsedMs: number, cap: number): number {
  if (elapsedMs <= 0 || sigma >= cap) return sigma;
  const cSq = (cap * cap - MIN_SIGMA * MIN_SIGMA) / T_MAX_DAYS;
  const t = elapsedMs / MS_PER_DAY;
  return Math.min(cap, Math.sqrt(sigma * sigma + cSq * t));
}

/**
 * Measure how surprising a match result was relative to the expected outcome.
 * Returns a value >= 0; higher means more surprising.
 */
export function computeSurprise(ratingA: number, ratingB: number, result: 'A' | 'B' | 'D'): number {
  const E = expectedScore(ratingA, ratingB);
  const S = result === 'A' ? 1 : result === 'D' ? 0.5 : 0;
  const observed = Math.abs(S - E);
  const baseline = 2 * E * (1 - E);
  return Math.max(0, observed - baseline);
}

/**
 * Glicko-1 rating + sigma update for one player after a single comparison.
 *
 * Computes both the new rating and new sigma in one pass, sharing the
 * intermediates (g, E, d^2). Sigma alone governs step size - no K-factor needed.
 *
 * @param score 1 = win, 0.5 = draw, 0 = loss (from i's perspective)
 */
export function glickoUpdate(
  rI: number,
  rJ: number,
  sigmaI: number,
  sigmaJ: number,
  score: number,
): { newRating: number; newSigma: number } {
  const g = gSigma(sigmaJ);
  const E = 1 / (1 + Math.pow(10, (-g * (rI - rJ)) / 400));
  const dSq = 1 / (Q * Q * g * g * E * (1 - E));

  const sigmaISq = sigmaI * sigmaI;
  const newRating = rI + (Q * sigmaISq * g * (score - E)) / (1 + (Q * Q * sigmaISq) / dSq);
  const newSigma = 1 / Math.sqrt(1 / sigmaISq + 1 / dSq);

  return {
    newRating,
    newSigma: Math.max(MIN_SIGMA, Math.min(DEFAULT_SIGMA, newSigma)),
  };
}
