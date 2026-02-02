import type { App, TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import type { CohortDefinition, CohortKind, CohortParamsMap, CohortSpec } from '../../types';
import { normaliseTag } from '../../utils/tags';
import { resolveFilesFromBaseView } from '../bases/BasesCohortResolver';

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

function normaliseFolderPathForPrefix(pathRaw: string | undefined): string {
  let p = (pathRaw ?? '').trim();
  if (p === '/') p = '';
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  return p;
}

function excludeFolderFromFiles(files: TFile[], folderPathRaw?: string): TFile[] {
  const folderPath = normaliseFolderPathForPrefix(folderPathRaw);
  if (!folderPath) return files;

  const prefix = folderPath + '/';
  return files.filter((f) => !f.path.startsWith(prefix));
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
  parse: (key: string) => { kind: K; params: CohortParamsMap[K]; label: string } | undefined;
  pretty: (params: CohortParamsMap[K]) => string;
  resolve: (app: App, params: CohortParamsMap[K]) => Promise<TFile[]>;
};

type CohortHandlersMap = { [K in CohortKind]: Handler<K> };

const handlers: CohortHandlersMap = {
  'vault:all': {
    makeKey: () => 'vault:all',
    parse: (key) =>
      key === 'vault:all'
        ? { kind: 'vault:all', params: {}, label: 'Vault: all notes' }
        : undefined,
    pretty: () => 'Vault: all notes',
    resolve: (app) => Promise.resolve(app.vault.getMarkdownFiles()),
  },

  folder: {
    makeKey: (p) => `folder:${p.path}`,
    parse: (key) => {
      if (!key.startsWith('folder:')) return undefined;
      const path = key.slice('folder:'.length);
      return { kind: 'folder', params: { path }, label: `Folder: ${path}` };
    },
    pretty: (p) => `Folder: ${p.path}`,
    resolve: (app, p) => {
      const all = app.vault.getMarkdownFiles();
      const filtered = all.filter((f) => f.parent?.path === p.path);
      return Promise.resolve(filtered);
    },
  },

  'folder-recursive': {
    makeKey: (p) => `folder-recursive:${p.path}`,
    parse: (key) => {
      if (!key.startsWith('folder-recursive:')) return undefined;
      const path = key.slice('folder-recursive:'.length);
      return {
        kind: 'folder-recursive',
        params: { path },
        label: `Folder (recursive): ${path}`,
      };
    },
    pretty: (p) => `Folder (recursive): ${p.path}`,
    resolve: (app, p) => {
      const all = app.vault.getMarkdownFiles();
      const prefix = p.path.length ? p.path + '/' : '';
      const filtered = all.filter((f) => (prefix === '' ? true : f.path.startsWith(prefix)));
      return Promise.resolve(filtered);
    },
  },

  'tag:any': {
    makeKey: (p) => {
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
    pretty: (p) => `Tag (any): ${p.tags.join(', ')}`,
    resolve: (app, p) => {
      const all = app.vault.getMarkdownFiles();
      const want: Set<string> = new Set(p.tags.map(normaliseTag));

      if (want.size === 0) return Promise.resolve([]);
      return Promise.resolve(
        all.filter((f) => {
          const tags = getFileTags(app, f);
          for (const t of tags) if (want.has(t)) return true;
          return false;
        }),
      );
    },
  },

  'tag:all': {
    makeKey: (p) => {
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
    pretty: (p) => `Tag (all): ${p.tags.join(', ')}`,
    resolve: (app, p) => {
      const all = app.vault.getMarkdownFiles();
      const want: Set<string> = new Set(p.tags.map(normaliseTag));
      if (want.size === 0) return Promise.resolve([]);
      return Promise.resolve(
        all.filter((f) => {
          const tags = new Set(getFileTags(app, f));
          for (const t of want) if (!tags.has(t)) return false;
          return true;
        }),
      );
    },
  },

  manual: {
    makeKey: (p) => `manual:${p.paths.slice().sort().join('|')}`,
    parse: (key) => {
      if (!key.startsWith('manual:')) return undefined;
      const paths = key.slice('manual:'.length).split('|').filter(Boolean);
      return {
        kind: 'manual',
        params: { paths },
        label: `Manual (${paths.length} notes)`,
      };
    },
    pretty: (p) => `Manual (${p.paths.length} notes)`,
    resolve: (app, p) => {
      const out: TFile[] = [];
      for (const path of p.paths) {
        const af = app.vault.getAbstractFileByPath(path);
        if (af instanceof TFile && af.extension === 'md') out.push(af);
      }
      return Promise.resolve(out);
    },
  },

  base: {
    makeKey: (p) => {
      const baseId = String(p.baseId ?? '');
      const view = String(p.view ?? '');
      return `base:${baseId}|view=${encodeURIComponent(view)}`;
    },

    parse: (key) => {
      if (!key.startsWith('base:')) return undefined;
      const rest = key.slice('base:'.length);
      const [baseId, ...restParts] = rest.split('|');

      let view: string | undefined;
      for (const rp of restParts) {
        const [k, v] = rp.split('=', 2);
        if (k === 'view' && typeof v === 'string') view = decodeURIComponent(v);
      }

      if (!baseId || !view) return undefined;

      const label = `Base: ${baseId} (${view})`;
      return { kind: 'base', params: { baseId, view }, label };
    },

    pretty: (p) => `Base: ${p.baseId} (${p.view})`,

    resolve: async (app, p) => {
      return await resolveFilesFromBaseView(app, p.baseId, p.view);
    },
  },
};

function getHandler<K extends CohortKind>(kind: K): Handler<K> {
  return handlers[kind];
}

const KIND_ORDER: readonly CohortKind[] = [
  'vault:all',
  'folder',
  'folder-recursive',
  'tag:any',
  'tag:all',
  'manual',
  'base',
] as const;

export function makeCohortKey<K extends CohortKind>(spec: CohortSpec<K>): string {
  return getHandler(spec.kind).makeKey(spec.params);
}

export function parseCohortKey(key: string): CohortDefinition | undefined {
  for (const kind of KIND_ORDER) {
    const parsed = getHandler(kind).parse(key);
    if (parsed) {
      const now = Date.now();
      return {
        key,
        kind: parsed.kind,
        params: parsed.params,
        label: parsed.label,
        createdAt: now,
        updatedAt: now,
      } as CohortDefinition;
    }
  }
  return undefined;
}

type KindAndParams<K extends CohortKind> = { kind: K; params: CohortParamsMap[K] };

export function prettyCohortDefinition<K extends CohortKind>(def: KindAndParams<K>): string {
  return getHandler(def.kind).pretty(def.params);
}

export function createDefinition<K extends CohortKind>(
  spec: CohortSpec<K> & { label?: string },
): CohortDefinition {
  const ts = Date.now();
  const key = makeCohortKey(spec);
  return {
    key,
    kind: spec.kind,
    params: spec.params,
    label: spec.label,
    createdAt: ts,
    updatedAt: ts,
  } as CohortDefinition;
}

export async function resolveFilesForCohort<K extends CohortKind>(
  app: App,
  def: KindAndParams<K>,
  opts?: { excludeFolderPath?: string },
): Promise<TFile[]> {
  const files = await getHandler(def.kind).resolve(app, def.params);
  return excludeFolderFromFiles(files, opts?.excludeFolderPath);
}

export function allFolderChoices(app: App): TFolder[] {
  return getAllFolders(app);
}
