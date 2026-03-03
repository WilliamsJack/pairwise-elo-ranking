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
