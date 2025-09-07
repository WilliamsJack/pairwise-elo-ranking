import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import { CohortDefinition, CohortKind } from '../../types';

import { normaliseTag } from '../../utils/tags';

function getAllFolders(app: App): TFolder[] {
  const out: TFolder[] = [];
  const walk = (f: TAbstractFile) => {
    if (f instanceof TFolder) {
      out.push(f);
      for (const child of f.children) walk(child);
    }
  };
  walk(app.vault.getRoot());
  return out;
}

function getFileTags(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  const set = new Set<string>();

  // Body tags
  if (cache?.tags) {
    for (const t of cache.tags) if (t?.tag) set.add(t.tag);
  }

  // Frontmatter tags (string | string[] | unknown)
  const fmTags: unknown = cache?.frontmatter?.tags;
  if (Array.isArray(fmTags)) {
    for (const t of fmTags) if (typeof t === 'string') set.add(normaliseTag(t));
  } else if (typeof fmTags === 'string') {
    // Split by commas or whitespace
    for (const t of fmTags.split(/[,\s]+/g)) {
      const n = normaliseTag(t);
      if (n && n !== '#') set.add(n);
    }
  }

  return Array.from(set);
}

export function makeCohortKey(kind: CohortKind, params: any): string {
  switch (kind) {
    case 'vault:all':
      return 'vault:all';
    case 'folder':
      return `folder:${params.path}`;
    case 'folder-recursive':
      return `folder-recursive:${params.path}`;
    case 'tag:any': {
      const tags: string[] = (params?.tags ?? []).map(normaliseTag).filter(Boolean).sort();
      return `tag:any:${tags.join('|')}`;
    }
    case 'tag:all': {
      const tags: string[] = (params?.tags ?? []).map(normaliseTag).filter(Boolean).sort();
      return `tag:all:${tags.join('|')}`;
    }
    case 'manual': {
      const paths: string[] = (params?.paths ?? []).slice().sort();
      return `manual:${paths.join('|')}`;
    }
    case 'base': {
      const baseId = String(params?.baseId ?? '');
      const view = params?.view ? `|view=${params.view}` : '';
      return `base:${baseId}${view}`;
    }
    default:
      return 'vault:all';
  }
}

export function parseCohortKey(key: string): CohortDefinition | undefined {
  // Known forms:
  // - vault:all
  // - folder:<path>
  // - folder-recursive:<path>
  // - tag:any:<t1|t2|...>
  // - tag:all:<t1|t2|...>
  // - manual:<path1|path2|...>
  // - base:<baseId>[|view=ViewName]
  if (key === 'vault:all') {
    return {
      key,
      kind: 'vault:all',
      label: 'Vault: All notes',
      params: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  const [head, rest] = key.split(':', 2);
  if (!rest) return undefined;

  if (head === 'folder') {
    return {
      key,
      kind: 'folder',
      label: `Folder: ${rest}`,
      params: { path: rest },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
  if (head === 'folder-recursive') {
    return {
      key,
      kind: 'folder-recursive',
      label: `Folder (recursive): ${rest}`,
      params: { path: rest },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
  if (head === 'tag') {
    const [mode, tagsRaw] = rest.split(':', 2);
    const tags = (tagsRaw ?? '').split('|').map(normaliseTag).filter(Boolean);
    if (mode === 'any' || mode === 'all') {
      const kind = (`tag:${mode}`) as CohortKind;
      return {
        key,
        kind,
        label: `Tag ${mode}: ${tags.join(', ')}`,
        params: { tags },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
  }
  if (head === 'manual') {
    const paths = rest.split('|').filter(Boolean);
    return {
      key,
      kind: 'manual',
      label: `Manual (${paths.length} notes)`,
      params: { paths },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
  if (head === 'base') {
    const [baseId, ...restParts] = rest.split('|');
    let view: string | undefined;
    for (const p of restParts) {
      const [k, v] = p.split('=', 2);
      if (k === 'view') view = v;
    }
    return {
      key,
      kind: 'base',
      label: view ? `Base: ${baseId} (${view})` : `Base: ${baseId}`,
      params: { baseId, view },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  return undefined;
}

export function labelForDefinition(def: CohortDefinition): string {
  if (def.label) return def.label;
  switch (def.kind) {
    case 'vault:all': return 'Vault: All notes';
    case 'folder': return `Folder: ${def.params.path}`;
    case 'folder-recursive': return `Folder (recursive): ${def.params.path}`;
    case 'tag:any': return `Tag any: ${(def.params.tags ?? []).join(', ')}`;
    case 'tag:all': return `Tag all: ${(def.params.tags ?? []).join(', ')}`;
    case 'manual': return `Manual (${(def.params.paths ?? []).length} notes)`;
    case 'base': {
      const v = def.params.view ? ` (${def.params.view})` : '';
      return `Base: ${def.params.baseId}${v}`;
    }
    default: return def.key;
  }
}

export function createDefinition(kind: CohortKind, params: any, label?: string): CohortDefinition {
  const key = makeCohortKey(kind, params);
  const ts = Date.now();
  return { key, kind, params, label: label ?? undefined, createdAt: ts, updatedAt: ts };
}

export function resolveFilesForCohort(app: App, def: CohortDefinition): TFile[] {
  const all = app.vault.getMarkdownFiles();

  switch (def.kind) {
    case 'vault:all':
      return all;

    case 'folder': {
      const folderPath: string = def.params.path ?? '';
      return all.filter((f) => f.parent?.path === folderPath);
    }

    case 'folder-recursive': {
      const folderPath: string = def.params.path ?? '';
      const prefix = folderPath.length ? folderPath + '/' : '';
      // Include all files under the folder (direct and nested)
      return all.filter((f) => prefix === '' ? true : f.path.startsWith(prefix));
    }

    case 'tag:any': {
      const want: Set<string> = new Set((def.params.tags ?? []).map(normaliseTag));
      if (want.size === 0) return [];
      return all.filter((f) => {
        const tags = getFileTags(app, f);
        for (const t of tags) if (want.has(t)) return true;
        return false;
      });
    }

    case 'tag:all': {
      const want: Set<string> = new Set((def.params.tags ?? []).map(normaliseTag));
      if (want.size === 0) return [];
      return all.filter((f) => {
        const tags = new Set(getFileTags(app, f));
        for (const t of want) if (!tags.has(t)) return false;
        return true;
      });
    }

    case 'manual': {
      const paths: string[] = def.params.paths ?? [];
      const out: TFile[] = [];
      for (const p of paths) {
        const af = app.vault.getAbstractFileByPath(p);
        if (af instanceof TFile && af.extension === 'md') out.push(af);
      }
      return out;
    }

    case 'base': {
      // Placeholder for future Bases integration, pending the Bases API
      return [];
    }

    default:
      return [];
  }
}

export function allFolderChoices(app: App): TFolder[] {
  return getAllFolders(app);
}
