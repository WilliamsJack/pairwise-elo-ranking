import { MatchResult } from '../../types';

export function expectedScore(rA: number, rB: number): number {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

export function updateElo(
  rA: number,
  rB: number,
  result: MatchResult,
  K: number
): { newA: number; newB: number } {
  const eA = expectedScore(rA, rB);
  const sA = result === 'A' ? 1 : result === 'D' ? 0.5 : 0;
  const sB = 1 - sA;
  return {
    newA: rA + K * (sA - eA),
    newB: rB + K * (sB - (1 - eA)),
  };
}
