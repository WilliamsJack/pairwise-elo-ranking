export function normaliseTag(tag: string): string {
  const t = (tag ?? '').trim();
  if (!t) return '';
  return t.startsWith('#') ? t : `#${t}`;
}

// "#a/b/c" => ["#a", "#a/b", "#a/b/c"]
export function expandTagHierarchy(tagRaw: string): string[] {
  const tag = normaliseTag(tagRaw);
  if (!tag || tag === '#') return [];

  const body = tag.slice(1); // remove leading '#'
  const parts = body
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];

  const out: string[] = [];
  let cur = '';
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    out.push(`#${cur}`);
  }
  return out;
}
