export function normaliseTag(tag: string): string {
  const t = (tag ?? '').trim();
  if (!t) return '';
  return t.startsWith('#') ? t : `#${t}`;
}
