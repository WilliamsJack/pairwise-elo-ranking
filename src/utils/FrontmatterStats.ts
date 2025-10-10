import { App, Notice, TFile } from 'obsidian';

import { CohortData } from '../types';
import type { FrontmatterPropertiesSettings } from '../settings';
import { getEloId } from './NoteIds';

type PlayerStats = {
  rating: number;
  matches: number;
  wins: number;
  rank: number;
};

function anyEnabled(fm: FrontmatterPropertiesSettings): boolean {
  return (
    !!fm?.rating?.enabled ||
    !!fm?.rank?.enabled ||
    !!fm?.matches?.enabled ||
    !!fm?.wins?.enabled
  );
}

// Standard competition ranking ("1224" style)
export function computeRankMap(cohort: CohortData): Map<string, number> {
  const entries = Object.entries(cohort.players);
  entries.sort((a, b) => b[1].rating - a[1].rating);

  const map = new Map<string, number>();
  let lastRating: number | undefined = undefined;
  let rank = 0;
  let nextRank = 1;

  for (let i = 0; i < entries.length; i++) {
    const [id, player] = entries[i];
    if (lastRating === undefined || player.rating !== lastRating) {
      rank = nextRank;
      lastRating = player.rating;
    }
    map.set(id, rank);
    nextRank = i + 2;
  }
  return map;
}

function buildProps(fm: FrontmatterPropertiesSettings, stats: PlayerStats): Record<string, number> {
  const out: Record<string, number> = {};

  if (fm.rating.enabled && fm.rating.property) {
    out[fm.rating.property] = Math.round(stats.rating);
  }
  if (fm.rank.enabled && fm.rank.property) {
    out[fm.rank.property] = stats.rank;
  }
  if (fm.matches.enabled && fm.matches.property) {
    out[fm.matches.property] = stats.matches;
  }
  if (fm.wins.enabled && fm.wins.property) {
    out[fm.wins.property] = stats.wins;
  }
  return out;
}

async function writeProps(app: App, file: TFile, props: Record<string, number>): Promise<void> {
  if (Object.keys(props).length === 0) return;
  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const [k, v] of Object.entries(props)) {
      fm[k] = v;
    }
  });
}

export async function writeFrontmatterStatsForPair(
  app: App,
  fm: FrontmatterPropertiesSettings,
  cohort: CohortData | undefined,
  aFile?: TFile,
  aId?: string,
  bFile?: TFile,
  bId?: string,
): Promise<void> {
  if (!cohort) return;
  if (!anyEnabled(fm)) return;

  const rankMap = computeRankMap(cohort);
  const tasks: Promise<void>[] = [];

  if (aFile && aId) {
    const p = cohort.players[aId];
    if (p) {
      const props = buildProps(fm, {
        rating: p.rating,
        matches: p.matches,
        wins: p.wins,
        rank: rankMap.get(aId) ?? rankMap.size,
      });
      tasks.push(writeProps(app, aFile, props));
    }
  }

  if (bFile && bId) {
    const p = cohort.players[bId];
    if (p) {
      const props = buildProps(fm, {
        rating: p.rating,
        matches: p.matches,
        wins: p.wins,
        rank: rankMap.get(bId) ?? rankMap.size,
      });
      tasks.push(writeProps(app, bFile, props));
    }
  }

  await Promise.all(tasks);
}

type FrontmatterUpdatePlan =
  | { op: 'set'; file: TFile; setKey: string; setValue: number; deleteKey?: string }
  | { op: 'delete'; file: TFile; deleteKey: string };

// Shared planner to compute per-file frontmatter updates (set and/or delete).
async function planFrontmatterUpdates(
  app: App,
  files: TFile[],
  valuesById: Map<string, number>,
  newPropName: string,
  oldPropName?: string,
): Promise<{ plans: FrontmatterUpdatePlan[] }> {
  const prop = (newPropName ?? '').trim();
  const oldProp = (oldPropName ?? '').trim();

  const plans: FrontmatterUpdatePlan[] = [];

  for (const file of files) {
    const id = await getEloId(app, file);
    if (!id) continue;

    const fmCache = app.metadataCache.getFileCache(file)?.frontmatter;

    // Removal-only mode: delete oldProp if present.
    if (!prop && oldProp) {
      const hasOld = typeof fmCache?.[oldProp] !== 'undefined';
      if (hasOld) {
        plans.push({ op: 'delete', file, deleteKey: oldProp });
      }
      continue;
    }

    // Nothing to do if no new prop.
    if (!prop) continue;

    // Only consider files that have a value provided for this id.
    const newVal = valuesById.get(id);
    if (typeof newVal === 'undefined') continue;

    const curNewRaw = fmCache?.[prop];
    const curNew =
      typeof curNewRaw === 'number'
        ? curNewRaw
        : typeof curNewRaw === 'string'
        ? parseInt(curNewRaw, 10)
        : undefined;

    const hasOld = !!oldProp && oldProp !== prop && typeof fmCache?.[oldProp] !== 'undefined';

    const needSet = curNew !== newVal;
    const needRemoveOld = hasOld;

    if (needSet || needRemoveOld) {
      if (needSet) {
        plans.push({
          op: 'set',
          file,
          setKey: prop,
          setValue: newVal,
          ...(needRemoveOld ? { deleteKey: oldProp } : {}),
        });
      } else {
        plans.push({ op: 'delete', file, deleteKey: oldProp });
      }
    }
  }

  return { plans };
}

// Compute how many files would be updated by a rename/remove operation.
export async function previewCohortFrontmatterPropertyUpdates(
  app: App,
  files: TFile[],
  valuesById: Map<string, number>,
  newPropName: string,
  oldPropName?: string,
): Promise<{ wouldUpdate: number }> {
  const { plans } = await planFrontmatterUpdates(app, files, valuesById, newPropName, oldPropName);
  return { wouldUpdate: plans.length };
}

// Generic bulk updater for frontmatter properties based on a values map.
// If oldPropName is provided, it will be removed if present (rename).
// If newPropName is empty and oldPropName is provided, performs removal only.
export async function updateCohortFrontmatterProperties(
  app: App,
  files: TFile[],
  valuesById: Map<string, number>,
  newPropName: string,
  oldPropName?: string,
): Promise<{ updated: number }> {
  const { plans } = await planFrontmatterUpdates(app, files, valuesById, newPropName, oldPropName);

  let updated = 0;
  for (const p of plans) {
    await app.fileManager.processFrontMatter(p.file, (yaml) => {
      if (p.op === 'set') {
        yaml[p.setKey] = p.setValue;
        if (p.deleteKey) {
          delete yaml[p.deleteKey];
        }
      } else {
        delete yaml[p.deleteKey];
      }
    });
    updated += 1;
  }

  return { updated };
}

/**
 * Convenience wrapper around updateCohortFrontmatterProperties that shows a working
 * notice while the update runs. Allows custom notice text.
 */
export async function updateCohortFrontmatter(
  app: App,
  files: TFile[],
  valuesById: Map<string, number>,
  newPropName: string,
  oldPropName?: string,
  noticeMessage?: string,
): Promise<{ updated: number }> {
  const working = new Notice(noticeMessage ?? 'Updating frontmatter...', 0);
  try {
    return await updateCohortFrontmatterProperties(app, files, valuesById, newPropName, oldPropName);
  } finally {
    working?.hide?.();
  }
}

export async function updateCohortRanksInFrontmatter(
  app: App,
  cohort: CohortData | undefined,
  files: TFile[],
  newPropName: string,
): Promise<{ updated: number }> {
  if (!cohort) return { updated: 0 };
  const rankMap = computeRankMap(cohort);
  return updateCohortFrontmatterProperties(app, files, rankMap, newPropName);
}
