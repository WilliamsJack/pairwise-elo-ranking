import type { TAbstractFile } from 'obsidian';
import { Notice, Plugin, TFile } from 'obsidian';

import { resetNoteRating } from './commands/ResetNoteRating';
import { reconcileCohortPlayersWithFiles } from './domain/cohort/CohortIntegrity';
import { resolveFilesForCohort } from './domain/cohort/CohortResolver';
import { DEFAULT_REPORT_TEMPLATE } from './domain/report/defaultReportTemplate';
import { generateOrOverwriteExampleTemplate } from './domain/report/generateExampleTemplate';
import { writeSessionReport } from './domain/report/SessionReportWriter';
import {
  computePlaceholders,
  resolveReportFileName,
  resolveTemplate,
} from './domain/report/TemplatePlaceholders';
import type { GlickoSettings } from './settings';
import { effectiveFrontmatterProperties } from './settings';
import GlickoSettingsTab from './settings/SettingsTab';
import { PluginDataStore } from './storage/PluginDataStore';
import type { CohortDefinition, SessionMatchData } from './types';
import ArenaSession from './ui/ArenaSession';
import { CohortPicker } from './ui/CohortPicker';
import { ensureBaseCohortTarget } from './utils/EnsureBaseCohort';
import { ensureFolderCohortPath } from './utils/EnsureFolderCohort';
import { ensureUniqueIds } from './utils/EnsureUniqueIds';
import { computeRanksForAll, updateCohortFrontmatter } from './utils/FrontmatterStats';
import { debugWarn, setDebugLogging } from './utils/logger';

export default class GlickoPlugin extends Plugin {
  dataStore: PluginDataStore;
  settings: GlickoSettings;

  private currentSession?: ArenaSession;

  async onload() {
    this.dataStore = new PluginDataStore(this);
    await this.dataStore.load();
    this.settings = this.dataStore.settings;
    setDebugLogging(this.settings.debugLogging);

    this.addRibbonIcon('trophy', 'Start Glicko rating session', async () => {
      await this.selectCohortAndStart();
    });

    this.addCommand({
      id: 'glicko-start-session',
      name: 'Start rating session',
      callback: async () => {
        await this.selectCohortAndStart();
      },
    });

    this.addCommand({
      id: 'glicko-end-session',
      name: 'End current session',
      checkCallback: (checking) => {
        const has = !!this.currentSession;
        if (!checking && has) void this.endSession();
        return has;
      },
    });

    this.addCommand({
      id: 'glicko-reset-note-rating',
      name: 'Reset rating for active note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) void resetNoteRating(this.app, this.dataStore, this.settings, file);
        return true;
      },
    });

    this.addCommand({
      id: 'glicko-generate-report-template',
      name: 'Generate example report template',
      callback: async () => {
        try {
          const file = await generateOrOverwriteExampleTemplate(this.app, {
            filePath: this.settings.sessionReport.reportTemplatePath,
            templatesFolderPath:
              this.settings.templatesFolderPath || this.settings.sessionReport.folderPath || '',
          });
          if (!file) return;

          this.settings.sessionReport.reportTemplatePath = file.path;
          await this.saveSettings();
          const leaf = this.app.workspace.getLeaf('tab');
          await leaf.openFile(file);
          new Notice('Report template created and set as default.');
        } catch (e) {
          console.error('[Glicko] Failed to generate example template', e);
          new Notice('Failed to generate example template.');
        }
      },
    });

    this.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.currentSession?.onFileRenamed(oldPath, file);
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on('delete', (file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.currentSession?.onFileDeleted(file.path);
        }
      }),
    );

    this.addSettingTab(new GlickoSettingsTab(this.app, this));
  }

  onunload(): void {
    void this.endSession({ forUnload: true });
    void this.dataStore.saveAllImmediate();
  }

  async saveSettings() {
    setDebugLogging(this.settings.debugLogging);
    await this.dataStore.saveSettings();
  }

  private async selectCohortAndStart() {
    const picker = new CohortPicker(this.app, this);
    let def = await picker.openAndGetSelection();
    if (!def) return;

    // Recover folder for folder-based cohorts if missing
    def = await ensureFolderCohortPath(this.app, this.dataStore, def);
    if (!def) return;

    // Recover base/view for base-based cohorts if missing
    def = await ensureBaseCohortTarget(this.app, this.dataStore, def);
    if (!def) return;

    const files = await resolveFilesForCohort(this.app, def, {
      excludeFolderPath: this.settings.templatesFolderPath,
    });

    if (files.length < 2) {
      new Notice('Need at least two Markdown notes to compare.');
      return;
    }

    if (!this.dataStore.getCohortDef(def.key)) {
      this.dataStore.upsertCohortDef(def);
      await this.dataStore.saveStore();
    }

    await this.startSessionForCohort(def, files, { saveDef: false });
  }

  private async startSessionForCohort(
    def: CohortDefinition,
    files: TFile[],
    _opts?: { saveDef?: boolean },
  ) {
    await this.endSession();

    const ok = await ensureUniqueIds(this.app, files, this.settings.idPropertyName);
    if (!ok) return;

    this.currentSession = new ArenaSession(this.app, this, def.key, files);

    // Await the UI start so the currently displayed notes have IDs if needed
    await this.currentSession.start();

    this.dataStore.setLastUsedCohortKey(def.key);
    void this.dataStore.saveStore();

    // Run cohort integrity scan after start()
    void reconcileCohortPlayersWithFiles(
      this.app,
      this.dataStore,
      def.key,
      files,
      this.settings.idPropertyName,
    ).catch((e) => {
      debugWarn('Cohort integrity reconciliation failed', e);
    });
  }

  public async endSession(opts?: { forUnload?: boolean }) {
    if (!this.currentSession) return;

    const session = this.currentSession;
    const cohortKey = session.getCohortKey();

    // Capture session data BEFORE end() clears the undo stack
    let sessionData: SessionMatchData | undefined;
    if (!opts?.forUnload) {
      sessionData = session.captureSessionData();
    }

    await session.end({ forUnload: !!opts?.forUnload });
    this.currentSession = undefined;

    // On unload, skip cohort-wide frontmatter updates and any additional work
    if (opts?.forUnload) return;

    const def = this.dataStore.getCohortDef(cohortKey);
    const cohort = this.dataStore.store.cohorts[cohortKey];

    // Generate session report if enabled and there were matches
    if (sessionData && sessionData.matches.length > 0 && def) {
      const reportConfig = def.sessionReport;
      if (reportConfig?.enabled) {
        try {
          const cohortLabel = def.label ?? def.key;
          let template: string | undefined;
          const templatePath = reportConfig.reportTemplatePath?.trim();
          if (templatePath) {
            const tFile = this.app.vault.getAbstractFileByPath(templatePath);
            if (tFile instanceof TFile) {
              template = await this.app.vault.read(tFile);
            } else {
              new Notice(
                `Report template not found at '${templatePath}', using built-in template.`,
              );
            }
          }
          const reportNow = new Date();
          const placeholders = computePlaceholders(sessionData, cohort, cohortLabel, reportNow);
          const markdown = resolveTemplate(template ?? DEFAULT_REPORT_TEMPLATE, placeholders);
          const fileName = resolveReportFileName(
            reportConfig.nameTemplate || this.settings.sessionReport.nameTemplate,
            cohortLabel,
            sessionData.matches.length,
            reportNow,
          );
          const reportFile = await writeSessionReport(
            this.app,
            markdown,
            reportConfig.folderPath || this.settings.sessionReport.folderPath,
            fileName,
          );
          const leaf = this.app.workspace.getLeaf('tab');
          await leaf.openFile(reportFile);
          this.app.workspace.setActiveLeaf(leaf, { focus: true });
        } catch (e) {
          console.error('[Glicko] Failed to generate session report', e);
          new Notice('Failed to generate session report. Check the console for details.');
        }
      }
    }

    // After session ends, update rank across the cohort if enabled
    if (!def || !cohort) return;

    const fm = effectiveFrontmatterProperties(
      this.settings.frontmatterProperties,
      def.frontmatterOverrides,
    );
    const rankCfg = fm.rank;
    if (!rankCfg.enabled || !rankCfg.property) return;

    const files = await resolveFilesForCohort(this.app, def, {
      excludeFolderPath: this.settings.templatesFolderPath,
    });
    if (files.length === 0) return;

    const rankMap = computeRanksForAll(cohort);

    updateCohortFrontmatter(
      this.app,
      files,
      rankMap,
      rankCfg.property,
      undefined,
      'Updating ranks in frontmatter...',
      this.settings.idPropertyName,
    ).catch((e) => {
      console.error('[Glicko] Failed to update ranks in frontmatter', e);
    });
  }
}
