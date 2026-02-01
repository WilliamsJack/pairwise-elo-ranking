import type { App, TFile } from 'obsidian';
import { Notice } from 'obsidian';

import type { EloIdLocation } from '../settings';
import {
  extractEloIdFromHtmlComment,
  getEloIdFromFrontmatterCache,
  overwriteEloIdInHtmlComment,
  removeEloIdFromFrontmatter,
  removeEloIdHtmlComments,
  setEloIdInFrontmatter,
} from './NoteIds';

const DEFAULT_POOL = 8;

export type EloIdTransferPlan = {
  file: TFile;

  setFrontmatterId?: string;
  setHtmlCommentId?: string;

  deleteFrontmatter?: boolean;
  deleteHtmlComment?: boolean;

  // Informational only: indicates the note had both IDs and they differed.
  // Resolved by preferring frontmatter.
  mismatch?: boolean;
  mismatchDetails?: { frontmatterId?: string; htmlCommentId?: string };
};

export type EloIdTransferPlanResult = {
  from: EloIdLocation;
  to: EloIdLocation;
  plans: EloIdTransferPlan[];
  wouldUpdate: number;
  mismatches: number;
};

async function planForFile(
  app: App,
  file: TFile,
  from: EloIdLocation,
  to: EloIdLocation,
): Promise<EloIdTransferPlan | undefined> {
  const fmId = getEloIdFromFrontmatterCache(app, file);

  // Frontmatter -> HTML: frontmatter is source of truth - overwrite HTML comment, then delete frontmatter.
  if (from === 'frontmatter' && to === 'end') {
    if (!fmId) return undefined;
    return { file, deleteHtmlComment: true, setHtmlCommentId: fmId, deleteFrontmatter: true };
  }

  // HTML -> frontmatter: read the body to find a HTML comment id (if any).
  if (from === 'end' && to === 'frontmatter') {
    let htmlCommentId: string | undefined;
    try {
      const text = await app.vault.cachedRead(file);
      htmlCommentId = extractEloIdFromHtmlComment(text);
    } catch {
      htmlCommentId = undefined;
    }

    // If frontmatter exists, it is canonical. If a HTML comment exists, remove it.
    if (fmId) {
      if (!htmlCommentId) return undefined;

      const mismatch = htmlCommentId !== fmId;
      return mismatch
        ? {
            file,
            deleteHtmlComment: true,
            mismatch: true,
            mismatchDetails: { frontmatterId: fmId, htmlCommentId },
          }
        : { file, deleteHtmlComment: true };
    }

    // No frontmatter id: if we have a HTML comment id, move it into frontmatter and delete HTML comment(s).
    if (!htmlCommentId) return undefined;
    return { file, setFrontmatterId: htmlCommentId, deleteHtmlComment: true };
  }

  return undefined;
}

export async function planEloIdTransfer(
  app: App,
  files: TFile[],
  from: EloIdLocation,
  to: EloIdLocation,
  opts?: { pool?: number },
): Promise<EloIdTransferPlanResult> {
  const pool = Math.max(1, Math.round(opts?.pool ?? DEFAULT_POOL));

  // Candidate reduction for frontmatter -> html:
  // only files with frontmatter eloId need work.
  const candidates =
    from === 'frontmatter' && to === 'end'
      ? files.filter((f) => !!getEloIdFromFrontmatterCache(app, f))
      : files;

  const plans: EloIdTransferPlan[] = [];
  let mismatches = 0;

  let idx = 0;
  const worker = async () => {
    while (true) {
      const i = idx++;
      if (i >= candidates.length) break;
      const f = candidates[i];

      const plan = await planForFile(app, f, from, to);
      if (!plan) continue;

      plans.push(plan);
      if (plan.mismatch) mismatches += 1;
    }
  };

  await Promise.all(Array.from({ length: pool }, () => worker()));

  plans.sort((a, b) => a.file.path.localeCompare(b.file.path));

  const wouldUpdate = plans.length;

  return { from, to, plans, wouldUpdate, mismatches };
}

export async function applyEloIdTransferPlan(
  app: App,
  plan: EloIdTransferPlanResult,
  opts?: { noticeMessage?: string },
): Promise<{ updated: number; mismatches: number }> {
  const working = new Notice(opts?.noticeMessage ?? 'Transferring Elo IDs...', 0);

  let updated = 0;
  let mismatches = 0;

  try {
    for (const p of plan.plans) {
      if (p.mismatch) mismatches += 1;

      if (p.setHtmlCommentId) {
        await overwriteEloIdInHtmlComment(app, p.file, p.setHtmlCommentId);
      }

      if (p.setFrontmatterId) {
        await setEloIdInFrontmatter(app, p.file, p.setFrontmatterId);
      }

      if (p.deleteFrontmatter) {
        await removeEloIdFromFrontmatter(app, p.file);
      }

      // Delete-only HTML comment removal (typically html -> frontmatter).
      if (p.deleteHtmlComment && !p.setHtmlCommentId) {
        await removeEloIdHtmlComments(app, p.file);
      }

      updated += 1;
    }
  } finally {
    working?.hide?.();
  }

  return { updated, mismatches };
}
