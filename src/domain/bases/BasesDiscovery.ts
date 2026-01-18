import { App, TFile, parseYaml } from 'obsidian';

export type BaseViewInfo = {
  name: string;
  type?: string;
};

export function listBaseFiles(app: App): TFile[] {
  const all = app.vault.getFiles();
  return all.filter((f) => f.extension.toLowerCase() === 'base');
}

export async function readBaseViews(app: App, baseFile: TFile): Promise<BaseViewInfo[]> {
  try {
    const text = await app.vault.cachedRead(baseFile);
    const parsed = parseYaml(text) as unknown;

    if (!parsed || typeof parsed !== 'object') return [];

    const viewsRaw = (parsed as Record<string, unknown>)['views'];
    if (!Array.isArray(viewsRaw)) return [];

    const out: BaseViewInfo[] = [];
    for (const v of viewsRaw) {
      if (!v || typeof v !== 'object') continue;
      const vr = v as Record<string, unknown>;

      const name = typeof vr['name'] === 'string' ? vr['name'].trim() : '';
      if (!name) continue;

      const type = typeof vr['type'] === 'string' ? vr['type'].trim() : undefined;
      out.push({ name, type });
    }

    return out;
  } catch {
    return [];
  }
}
