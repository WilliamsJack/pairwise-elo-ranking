import type { App, TFile } from 'obsidian';
import { Notice } from 'obsidian';

import { prettyCohortDefinition, resolveFilesForCohort } from '../domain/cohort/CohortResolver';
import type { GlickoSettings } from '../settings';
import { effectiveFrontmatterProperties } from '../settings';
import type { PluginDataStore } from '../storage/PluginDataStore';
import { ConfirmModal } from '../ui/ConfirmModal';
import { ALL_SENTINEL, ResetNoteModal } from '../ui/ResetNoteModal';
import {
  computeRanksForAll,
  updateCohortFrontmatter,
  writeFrontmatterStatsForPlayer,
} from '../utils/FrontmatterStats';
import { getNoteId } from '../utils/NoteIds';

export async function resetNoteRating(
  app: App,
  dataStore: PluginDataStore,
  settings: GlickoSettings,
  file: TFile,
): Promise<void> {
  const noteId = await getNoteId(app, file, settings.idPropertyName);
  if (!noteId) {
    new Notice('This note has no note ID.');
    return;
  }

  // Find cohorts containing this player
  const matchingKeys = Object.keys(dataStore.store.cohorts).filter(
    (key) => !!dataStore.store.cohorts[key]?.players[noteId],
  );

  if (matchingKeys.length === 0) {
    new Notice('This note has no rating data in any cohort.');
    return;
  }

  let keysToReset: string[];

  if (matchingKeys.length === 1) {
    keysToReset = matchingKeys;
  } else {
    const chosen = await new ResetNoteModal(app, dataStore, matchingKeys).openAndGetValue();
    if (!chosen) return;

    keysToReset = chosen === ALL_SENTINEL ? matchingKeys : [chosen];
  }

  // Build cohort label for confirmation message
  const cohortLabel =
    keysToReset.length === matchingKeys.length && matchingKeys.length > 1
      ? 'all cohorts'
      : keysToReset
          .map((k) => {
            const def = dataStore.getCohortDef(k);
            return `'${def ? (def.label ?? prettyCohortDefinition(def)) : k}'`;
          })
          .join(', ');

  const ok = await new ConfirmModal(
    app,
    'Reset rating?',
    `Reset rating for '${file.basename}' in ${cohortLabel}? This will set the rating back to 1500 with full uncertainty.`,
    'Reset',
    'Cancel',
    true,
  ).openAndConfirm();
  if (!ok) return;

  for (const key of keysToReset) {
    dataStore.resetPlayer(key, noteId);
  }
  await dataStore.saveStore();

  new Notice(
    `Reset rating for '${file.basename}' in ${keysToReset.length} cohort${keysToReset.length === 1 ? '' : 's'}.`,
  );

  // Update frontmatter for affected cohorts
  for (const key of keysToReset) {
    const def = dataStore.getCohortDef(key);
    const cohort = dataStore.store.cohorts[key];
    if (!def || !cohort) continue;

    const fm = effectiveFrontmatterProperties(
      settings.frontmatterProperties,
      def.frontmatterOverrides,
    );

    const rankMap = computeRanksForAll(cohort);

    // Write the reset note's own stats (rating, matches, wins, rank)
    await writeFrontmatterStatsForPlayer(app, fm, cohort, file, noteId, rankMap);

    // Update rank across the whole cohort since relative ordering changed
    const rankCfg = fm.rank;
    if (!rankCfg.enabled || !rankCfg.property) continue;

    const cohortFiles = await resolveFilesForCohort(app, def, {
      excludeFolderPath: settings.templatesFolderPath,
    });
    if (cohortFiles.length === 0) continue;
    await updateCohortFrontmatter(
      app,
      cohortFiles,
      rankMap,
      rankCfg.property,
      undefined,
      'Updating ranks...',
      settings.idPropertyName,
    );
  }
}
