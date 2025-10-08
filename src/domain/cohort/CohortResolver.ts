import { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import {
  CohortDefinition,
  CohortKind,
  CohortParamsMap,
  CohortSpec,
} from '../../types';

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

// ---- Cohort registry: single source of truth per kind ----

type Handler<K extends CohortKind> = {
  makeKey: (params: CohortParamsMap[K]) => string;
  parse: (key: string) =>
    | { kind: K; params: CohortParamsMap[K]; label: string }
    | undefined;
  pretty: (params: CohortParamsMap[K]) => string;
  resolve: (app: App, params: CohortParamsMap[K]) => TFile[];
};

const handlers: Record<CohortKind, Handler<any>> = {
  'vault:all': {
    makeKey: () => 'vault:all',
    parse: (key) =>
      key === 'vault:all'
        ? { kind: 'vault:all', params: {}, label: 'Vault: all notes' }
        : undefined,
    pretty: () => 'Vault: all notes',
    resolve: (app) => app.vault.getMarkdownFiles(),
  },

  folder: {
    makeKey: (p: CohortParamsMap['folder']) => `folder:${p.path}`,
    parse: (key) => {
      if (!key.startsWith('folder:')) return undefined;
      const path = key.slice('folder:'.length);
      return { kind: 'folder', params: { path }, label: `Folder: ${path}` };
    },
    pretty: (p: CohortParamsMap['folder']) => `Folder: ${p.path}`,
    resolve: (app, p: CohortParamsMap['folder']) => {
      const all = app.vault.getMarkdownFiles();
      return all.filter((f) => f.parent?.path === p.path);
    },
  },

  'folder-recursive': {
    makeKey: (p: CohortParamsMap['folder-recursive']) =>
      `folder-recursive:${p.path}`,
    parse: (key) => {
      if (!key.startsWith('folder-recursive:')) return undefined;
      const path = key.slice('folder-recursive:'.length);
      return {
        kind: 'folder-recursive',
        params: { path },
        label: `Folder (recursive): ${path}`,
      };
    },
    pretty: (p: CohortParamsMap['folder-recursive']) =>
      `Folder (recursive): ${p.path}`,
    resolve: (app, p: CohortParamsMap['folder-recursive']) => {
      const all = app.vault.getMarkdownFiles();
      const prefix = p.path.length ? p.path + '/' : '';
      return all.filter((f) =>
        prefix === '' ? true : f.path.startsWith(prefix),
      );
    },
  },

  'tag:any': {
    makeKey: (p: CohortParamsMap['tag:any']) => {
      const tags = p.tags.map(normaliseTag).filter(Boolean).sort();
      return `tag:any:${tags.join('|')}`;
    },
    parse: (key) => {
      if (!key.startsWith('tag:any:')) return undefined;
      const raw = key.slice('tag:any:'.length);
      const tags = raw.split('|').map(normaliseTag).filter(Boolean);
      return {
        kind: 'tag:any',
        params: { tags },
        label: `Tag any: ${tags.join(', ')}`,
      };
    },
    pretty: (p: CohortParamsMap['tag:any']) =>
      `Tag (any): ${p.tags.join(', ')}`,
    resolve: (app, p: CohortParamsMap['tag:any']) => {
      const all = app.vault.getMarkdownFiles();
      const want: Set<string> = new Set(p.tags.map(normaliseTag));
      if (want.size === 0) return [];
      return all.filter((f) => {
        const tags = getFileTags(app, f);
        for (const t of tags) if (want.has(t)) return true;
        return false;
      });
    },
  },

  'tag:all': {
    makeKey: (p: CohortParamsMap['tag:all']) => {
      const tags = p.tags.map(normaliseTag).filter(Boolean).sort();
      return `tag:all:${tags.join('|')}`;
    },
    parse: (key) => {
      if (!key.startsWith('tag:all:')) return undefined;
      const raw = key.slice('tag:all:'.length);
      const tags = raw.split('|').map(normaliseTag).filter(Boolean);
      return {
        kind: 'tag:all',
        params: { tags },
        label: `Tag all: ${tags.join(', ')}`,
      };
    },
    pretty: (p: CohortParamsMap['tag:all']) =>
      `Tag (all): ${p.tags.join(', ')}`,
    resolve: (app, p: CohortParamsMap['tag:all']) => {
      const all = app.vault.getMarkdownFiles();
      const want: Set<string> = new Set(p.tags.map(normaliseTag));
      if (want.size === 0) return [];
      return all.filter((f) => {
        const tags = new Set(getFileTags(app, f));
        for (const t of want) if (!tags.has(t)) return false;
        return true;
      });
    },
  },

  manual: {
    makeKey: (p: CohortParamsMap['manual']) =>
      `manual:${p.paths.slice().sort().join('|')}`,
    parse: (key) => {
      if (!key.startsWith('manual:')) return undefined;
      const paths = key.slice('manual:'.length).split('|').filter(Boolean);
      return {
        kind: 'manual',
        params: { paths },
        label: `Manual (${paths.length} notes)`,
      };
    },
    pretty: (p: CohortParamsMap['manual']) =>
      `Manual (${p.paths.length} notes)`,
    resolve: (app, p: CohortParamsMap['manual']) => {
      const out: TFile[] = [];
      for (const path of p.paths) {
        const af = app.vault.getAbstractFileByPath(path);
        if (af instanceof TFile && af.extension === 'md') out.push(af);
      }
      return out;
    },
  },

  base: {
    makeKey: (p: CohortParamsMap['base']) => {
      const view = p.view ? `|view=${p.view}` : '';
      return `base:${String(p.baseId ?? '')}${view}`;
    },
    parse: (key) => {
      if (!key.startsWith('base:')) return undefined;
      const rest = key.slice('base:'.length);
      const [baseId, ...restParts] = rest.split('|');
      let view: string | undefined;
      for (const rp of restParts) {
        const [k, v] = rp.split('=', 2);
        if (k === 'view') view = v;
      }
      const label = view ? `Base: ${baseId} (${view})` : `Base: ${baseId}`;
      return { kind: 'base', params: { baseId, view }, label };
    },
    pretty: (p: CohortParamsMap['base']) =>
      `Base: ${p.baseId}${p.view ? ` (${p.view})` : ''}`,
    resolve: () => {
      // Placeholder for future Bases integration, pending the Bases API
      return [];
    },
  },
};

export function makeCohortKey(spec: CohortSpec): string {
  const h = handlers[spec.kind];
  return h.makeKey(spec.params as any);
}

export function parseCohortKey(key: string): CohortDefinition | undefined {
  const parsed =
    handlers['vault:all'].parse(key) ??
    handlers['folder'].parse(key) ??
    handlers['folder-recursive'].parse(key) ??
    handlers['tag:any'].parse(key) ??
    handlers['tag:all'].parse(key) ??
    handlers['manual'].parse(key) ??
    handlers['base'].parse(key);

  if (!parsed) return undefined;

  const now = Date.now();
  return {
    key,
    kind: parsed.kind,
    params: parsed.params as any,
    label: parsed.label,
    createdAt: now,
    updatedAt: now,
  };
}

export function prettyCohortDefinition(def: CohortDefinition): string {
  return handlers[def.kind].pretty(def.params as any);
}

export function createDefinition(spec: CohortSpec & { label?: string }): CohortDefinition {
  const ts = Date.now();
  const key = makeCohortKey(spec);
  return {
    key,
    kind: spec.kind,
    params: spec.params as any,
    label: spec.label,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function resolveFilesForCohort(app: App, def: CohortDefinition): TFile[] {
  return handlers[def.kind].resolve(app, def.params as any);
}

export function allFolderChoices(app: App): TFolder[] {
  return getAllFolders(app);
}
