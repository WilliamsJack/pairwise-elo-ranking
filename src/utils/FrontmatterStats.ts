import { App, TFile } from 'obsidian';

import { CohortData } from '../types';
import type { FrontmatterPropertiesSettings } from '../settings/settings';

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
function computeRankMap(cohort: CohortData): Map<string, number> {
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
