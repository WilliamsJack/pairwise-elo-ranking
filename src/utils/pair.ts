export function pairSig(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}
