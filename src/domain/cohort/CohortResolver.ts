import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import {
  CohortDefinition,
  CohortKind,
  CohortParams,
  CohortParamsMap,
  CohortSpec,
} from '../../types';

import { normaliseTag } from '../../utils/tags';

type ParamOf<K extends CohortKind> = CohortParamsMap[K];

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

export function getFileTags(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  const set = new Set<string>();

  // Body tags
  if (cache?.tags) {
    for (const t of cache.tags) if (t?.tag) set.add(normaliseTag(t.tag));
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

export function makeCohortKey<K extends CohortKind>(spec: CohortSpec<K>): string;
export function makeCohortKey<K extends CohortKind>(kind: K, params: CohortParamsMap[K]): string;

export function makeCohortKey(
  kindOrSpec: CohortKind | CohortSpec,
  paramsMaybe?: unknown,
): string {
  const spec: CohortSpec =
    typeof kindOrSpec === 'object' && kindOrSpec !== null && 'kind' in kindOrSpec
      ? (kindOrSpec as CohortSpec)
      : ({ kind: kindOrSpec as CohortKind, params: paramsMaybe as CohortParams } as CohortSpec);

  switch (spec.kind) {
    case 'vault:all':
      return 'vault:all';

    case 'folder': {
      const p = spec.params as ParamOf<'folder'>;
      return `folder:${p.path}`;
    }

    case 'folder-recursive': {
      const p = spec.params as ParamOf<'folder-recursive'>;
      return `folder-recursive:${p.path}`;
    }

    case 'tag:any': {
      const p = spec.params as ParamOf<'tag:any'>;
      const tags = p.tags.map(normaliseTag).filter(Boolean).sort();
      return `tag:any:${tags.join('|')}`;
    }

    case 'tag:all': {
      const p = spec.params as ParamOf<'tag:all'>;
      const tags = p.tags.map(normaliseTag).filter(Boolean).sort();
      return `tag:all:${tags.join('|')}`;
    }

    case 'manual': {
      const p = spec.params as ParamOf<'manual'>;
      const paths = p.paths.slice().sort();
      return `manual:${paths.join('|')}`;
    }

    case 'base': {
      const p = spec.params as ParamOf<'base'>;
      const view = p.view ? `|view=${p.view}` : '';
      return `base:${String(p.baseId ?? '')}${view}`;
    }
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
  const now = Date.now();

  if (key === 'vault:all') {
    return {
      key,
      kind: 'vault:all',
      label: 'Vault: all notes',
      params: {} as CohortParamsMap['vault:all'],
      createdAt: now,
      updatedAt: now,
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
      createdAt: now,
      updatedAt: now,
    };
  }

  if (head === 'folder-recursive') {
    return {
      key,
      kind: 'folder-recursive',
      label: `Folder (recursive): ${rest}`,
      params: { path: rest },
      createdAt: now,
      updatedAt: now,
    };
  }

  if (head === 'tag') {
    const [mode, tagsRaw] = rest.split(':', 2);
    const tags = (tagsRaw ?? '').split('|').map(normaliseTag).filter(Boolean);
    if (mode === 'any') {
      return {
        key,
        kind: 'tag:any',
        label: `Tag any: ${tags.join(', ')}`,
        params: { tags },
        createdAt: now,
        updatedAt: now,
      };
    } else if (mode === 'all') {
      return {
        key,
        kind: 'tag:all',
        label: `Tag all: ${tags.join(', ')}`,
        params: { tags },
        createdAt: now,
        updatedAt: now,
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
      createdAt: now,
      updatedAt: now,
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
      createdAt: now,
      updatedAt: now,
    };
  }

  return undefined;
}

export function prettyCohortDefinition(def: CohortDefinition): string {
  switch (def.kind) {
    case 'vault:all':
      return 'Vault: all notes';
    case 'folder':
      return `Folder: ${def.params.path}`;
    case 'folder-recursive':
      return `Folder (recursive): ${def.params.path}`;
    case 'tag:any':
      return `Tag (any): ${def.params.tags.join(', ')}`;
    case 'tag:all':
      return `Tag (all): ${def.params.tags.join(', ')}`;
    case 'manual':
      return `Manual (${def.params.paths.length} notes)`;
    case 'base': {
      const v = def.params.view ? ` (${def.params.view})` : '';
      return `Base: ${def.params.baseId}${v}`;
    }
  }
}

// Overloads keep existing call sites working
export function createDefinition<K extends CohortKind>(
  kind: K,
  params: CohortParamsMap[K],
  label?: string
): CohortDefinition;
export function createDefinition<K extends CohortKind>(
  spec: CohortSpec<K> & { label?: string }
): CohortDefinition;

export function createDefinition(
  kindOrSpec: CohortKind | (CohortSpec & { label?: string }),
  paramsMaybe?: unknown,
  label?: string,
): CohortDefinition {
  const ts = Date.now();

  if (typeof kindOrSpec === 'object' && kindOrSpec !== null && 'kind' in kindOrSpec) {
    const spec = kindOrSpec as CohortSpec & { label?: string };
    const key = makeCohortKey(spec);

    switch (spec.kind) {
      case 'vault:all':
        return {
          key,
          kind: 'vault:all',
          params: {} as CohortParamsMap['vault:all'],
          label: spec.label,
          createdAt: ts,
          updatedAt: ts,
        };
      case 'folder':
        return {
          key,
          kind: 'folder',
          params: spec.params as CohortParamsMap['folder'],
          label: spec.label,
          createdAt: ts,
          updatedAt: ts,
        };
      case 'folder-recursive':
        return {
          key,
          kind: 'folder-recursive',
          params: spec.params as CohortParamsMap['folder-recursive'],
          label: spec.label,
          createdAt: ts,
          updatedAt: ts,
        };
      case 'tag:any':
        return {
          key,
          kind: 'tag:any',
          params: spec.params as CohortParamsMap['tag:any'],
          label: spec.label,
          createdAt: ts,
          updatedAt: ts,
        };
      case 'tag:all':
        return {
          key,
          kind: 'tag:all',
          params: spec.params as CohortParamsMap['tag:all'],
          label: spec.label,
          createdAt: ts,
          updatedAt: ts,
        };
      case 'manual':
        return {
          key,
          kind: 'manual',
          params: spec.params as CohortParamsMap['manual'],
          label: spec.label,
          createdAt: ts,
          updatedAt: ts,
        };
      case 'base':
        return {
          key,
          kind: 'base',
          params: spec.params as CohortParamsMap['base'],
          label: spec.label,
          createdAt: ts,
          updatedAt: ts,
        };
    }
  }

  switch (kindOrSpec as CohortKind) {
    case 'vault:all': {
      const params = {} as CohortParamsMap['vault:all'];
      const key = makeCohortKey('vault:all', params);
      return { key, kind: 'vault:all', params, label, createdAt: ts, updatedAt: ts };
    }
    case 'folder': {
      const params = paramsMaybe as CohortParamsMap['folder'];
      const key = makeCohortKey('folder', params);
      return { key, kind: 'folder', params, label, createdAt: ts, updatedAt: ts };
    }
    case 'folder-recursive': {
      const params = paramsMaybe as CohortParamsMap['folder-recursive'];
      const key = makeCohortKey('folder-recursive', params);
      return { key, kind: 'folder-recursive', params, label, createdAt: ts, updatedAt: ts };
    }
    case 'tag:any': {
      const params = paramsMaybe as CohortParamsMap['tag:any'];
      const key = makeCohortKey('tag:any', params);
      return { key, kind: 'tag:any', params, label, createdAt: ts, updatedAt: ts };
    }
    case 'tag:all': {
      const params = paramsMaybe as CohortParamsMap['tag:all'];
      const key = makeCohortKey('tag:all', params);
      return { key, kind: 'tag:all', params, label, createdAt: ts, updatedAt: ts };
    }
    case 'manual': {
      const params = paramsMaybe as CohortParamsMap['manual'];
      const key = makeCohortKey('manual', params);
      return { key, kind: 'manual', params, label, createdAt: ts, updatedAt: ts };
    }
    case 'base': {
      const params = paramsMaybe as CohortParamsMap['base'];
      const key = makeCohortKey('base', params);
      return { key, kind: 'base', params, label, createdAt: ts, updatedAt: ts };
    }
  }
}

export function resolveFilesForCohort(app: App, def: CohortDefinition): TFile[] {
  const all = app.vault.getMarkdownFiles();

  switch (def.kind) {
    case 'vault:all':
      return all;

    case 'folder': {
      const folderPath = def.params.path;
      return all.filter((f) => f.parent?.path === folderPath);
    }

    case 'folder-recursive': {
      const folderPath = def.params.path;
      const prefix = folderPath.length ? folderPath + '/' : '';
      return all.filter((f) => (prefix === '' ? true : f.path.startsWith(prefix)));
    }

    case 'tag:any': {
      const want: Set<string> = new Set(def.params.tags.map(normaliseTag));
      if (want.size === 0) return [];
      return all.filter((f) => {
        const tags = getFileTags(app, f);
        for (const t of tags) if (want.has(t)) return true;
        return false;
      });
    }

    case 'tag:all': {
      const want: Set<string> = new Set(def.params.tags.map(normaliseTag));
      if (want.size === 0) return [];
      return all.filter((f) => {
        const tags = new Set(getFileTags(app, f));
        for (const t of want) if (!tags.has(t)) return false;
        return true;
      });
    }

    case 'manual': {
      const paths: string[] = def.params.paths;
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
  }
}

export function allFolderChoices(app: App): TFolder[] {
  return getAllFolders(app);
}
