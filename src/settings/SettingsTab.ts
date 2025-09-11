import { App, Notice, PluginSettingTab, Setting, SliderComponent, TextComponent, setIcon } from 'obsidian';
import { DEFAULT_SETTINGS, FrontmatterPropertiesSettings, SessionLayoutMode, effectiveFrontmatterProperties } from './settings';
import { computeRankMap, previewCohortFrontmatterPropertyUpdates, updateCohortFrontmatter } from '../utils/FrontmatterStats';
import { prettyCohortDefinition, resolveFilesForCohort } from '../domain/cohort/CohortResolver';

import { BasePromiseModal } from '../ui/PromiseModal';
import type { CohortData } from '../types';
import { CohortOptionsModal } from '../ui/CohortOptionsModal';
import type EloPlugin from '../main';

type PropKey = keyof FrontmatterPropertiesSettings;

class ConfirmModal extends BasePromiseModal<boolean> {
  private titleText: string;
  private message: string;
  private ctaText: string;
  private cancelText: string;

  constructor(app: App, titleText: string, message: string, ctaText: string, cancelText?: string) {
    super(app);
    this.titleText = titleText;
    this.message = message;
    this.ctaText = ctaText;
    this.cancelText = cancelText ? cancelText : 'Cancel';
  }

  async openAndConfirm(): Promise<boolean> {
    const v = await this.openAndGetValue();
    return !!v;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: this.titleText });
    const p = contentEl.createEl('p');
    p.textContent = this.message;

    const btns = new Setting(contentEl);
    btns.addButton((b) => b.setButtonText(this.cancelText).onClick(() => this.finish(false)));
    btns.addButton((b) => b.setCta().setButtonText(this.ctaText).onClick(() => this.finish(true)));
  }
}

class DeleteCohortModal extends BasePromiseModal<boolean> {
  private cohortLabel: string;

  constructor(app: App, cohortLabel: string) {
    super(app);
    this.cohortLabel = cohortLabel;
  }

  async openAndConfirm(): Promise<boolean> {
    const v = await this.openAndGetValue();
    return !!v;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Delete cohort?' });
    const p = contentEl.createEl('p');
    p.textContent = `Are you sure you want to delete "${this.cohortLabel}"? This removes the cohort and its saved ratings. Your notes will not be modified.`;

    const btns = new Setting(contentEl);
    // Grey Cancel
    btns.addButton((b) =>
      b.setButtonText('Cancel').onClick(() => {
        this.finish(false);
      }),
    );
    // Red Delete
    btns.addButton((b) =>
      b.setWarning().setButtonText('Delete').onClick(() => {
        this.finish(true);
      }),
    );
  }
}

export default class EloSettingsTab extends PluginSettingTab {
  plugin: EloPlugin;

  constructor(app: App, plugin: EloPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const minK = 8;
    const maxK = 64;
    const stepK = 1;
    let initialK = this.plugin.settings.kFactor;
    if (!Number.isFinite(initialK)) initialK = 24;
    initialK = Math.min(maxK, Math.max(minK, Math.round(initialK)));

    let minKSlider: SliderComponent | undefined;

    // General
    new Setting(containerEl)
      .setName('K-factor')
      .setDesc(`Adjusts how quickly ratings move (larger K = faster changes). Typical values 16–40. Default: ${DEFAULT_SETTINGS.kFactor}.`)
      .addSlider((s) => {
        s.setLimits(minK, maxK, stepK)
          .setValue(initialK)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.kFactor = value;

            // UI-level: clamp the "Minimum K" slider's max to the current base K
            // and clamp the stored minK if it now exceeds base K.
            const dec = this.plugin.settings.heuristics.decay;
            if (dec.minK > value) dec.minK = value;
    
            // Update the UI control if it exists
            minKSlider?.setLimits(4, value, 1);
            if (minKSlider && minKSlider.getValue() > value) minKSlider.setValue(value);

            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Show win/draw notices')
      .setDesc(`Show a toast with the winner after each comparison. Default: ${DEFAULT_SETTINGS.showToasts ? 'On' : 'Off'}.`)
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showToasts).onChange(async (v) => {
          this.plugin.settings.showToasts = v;
          await this.plugin.saveSettings();
        }),
      );

    // Session layout
    const layoutLabels: Record<SessionLayoutMode, string> = {
      'reuse-active': 'Reuse active pane',
      'right-split': 'Insert to the right of active pane',
      'new-tab': 'New tab',
      'new-window': 'New window (pop-out)',
    };
    new Setting(containerEl)
      .setName('Session layout')
      .setDesc('Choose how and where the arena opens.')
      .addDropdown((dd) => {
        dd.addOptions(layoutLabels as Record<SessionLayoutMode, string>)
          .setValue(this.plugin.settings.sessionLayout ?? DEFAULT_SETTINGS.sessionLayout)
          .onChange(async (v) => {
            const val: SessionLayoutMode =
              v === 'reuse-active' || v === 'right-split' || v === 'new-tab' || v === 'new-window' ? v : 'new-tab';
            this.plugin.settings.sessionLayout = val;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Elo ID location')
      .setDesc('Where to store the Elo ID. Changing this setting will not move existing IDs, but they will continue to work. Default: Frontmatter.')
      .addDropdown((dd) => {
        dd.addOptions({
          frontmatter: 'Frontmatter (YAML)',
          end: 'End of note (HTML comment)',
        })
          .setValue(this.plugin.settings.eloIdLocation ?? 'frontmatter')
          .onChange(async (v) => {
            const val = v === 'end' ? 'end' : 'frontmatter';
            this.plugin.settings.eloIdLocation = val;
            await this.plugin.saveSettings();
          });
      });

    // Cohort configuration
    new Setting(containerEl).setName('Cohorts').setHeading();

    containerEl.createEl('p', {
      text: 'Configure existing cohorts\' frontmatter properties or delete a cohort.',
    });

    const defs = this.plugin.dataStore.listCohortDefs();
    if (defs.length === 0) {
      containerEl.createEl('div', {
        cls: 'elo-muted',
        text: 'No cohorts saved yet. Start a session to create one, or use the Command Palette.',
      });
    } else {
      const list = containerEl.createDiv({ cls: 'installed-plugins-container' });

      // Sort by display label
      const sorted = defs.slice().sort((a, b) => {
        const an = (a.label ?? prettyCohortDefinition(a)).toLowerCase();
        const bn = (b.label ?? prettyCohortDefinition(b)).toLowerCase();
        return an.localeCompare(bn);
      });

      for (const def of sorted) {
        const row = list.createDiv({ cls: 'setting-item mod-toggle' });

        const info = row.createDiv({ cls: 'cohort-item-info' });
        info.addEventListener('click', async () => {
          await this.configureCohort(def.key);
        });

        const name = info.createDiv({ cls: 'setting-item-name', text: def.label ?? prettyCohortDefinition(def) });
        name.title = def.key;

        const desc = info.createDiv({ cls: 'setting-item-description' });
        desc.createDiv({ text: `Definition: ${prettyCohortDefinition(def)}` });

        const controls = row.createDiv({ cls: 'setting-item-control' });

        const settingsBtn = controls.createDiv({
          cls: 'clickable-icon extra-setting-button',
          attr: { 'aria-label': 'Configure cohort' },
        });
        setIcon(settingsBtn, 'settings');
        settingsBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await this.configureCohort(def.key);
        });

        const deleteBtn = controls.createDiv({
          cls: 'clickable-icon extra-setting-button',
          attr: { 'aria-label': 'Delete cohort' },
        });
        setIcon(deleteBtn, 'trash-2');
        deleteBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await this.deleteCohortWithConfirm(def.key);
        });
      }
    }

    // Advanced section
    new Setting(containerEl).setName('Advanced').setHeading();

    const fmAcc = containerEl.createEl('details', { cls: 'elo-settings-accordion' });
    fmAcc.open = false;
    fmAcc.createEl('summary', { text: 'Default frontmatter properties' });
    const fmBody = fmAcc.createEl('div', { cls: 'elo-settings-body' });

    const fm = this.plugin.settings.frontmatterProperties;

    new Setting(fmBody)
      .setName('Ask for per-cohort overrides on creation')
      .setDesc(`When creating a cohort, prompt to set frontmatter overrides. Turn off to always use the global defaults. 
        Disabling this may cause clashes if you write frontmatter properties across multiple cohorts.
        Default: ${DEFAULT_SETTINGS.askForOverridesOnCohortCreation ? 'On' : 'Off'}`)
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.askForOverridesOnCohortCreation)
          .onChange(async (v) => {
            this.plugin.settings.askForOverridesOnCohortCreation = v;
            await this.plugin.saveSettings();
          }),
      );
    
    fmBody.createEl('p', {
      text:
        'Choose which Elo statistics to write into a note\'s frontmatter and the property names to use. ' +
        'These are global defaults; cohort-specific overrides can be applied during creation.',
    });

    const addFrontmatterSetting = (
      parent: HTMLElement,
      key: keyof typeof fm,
      label: string,
      desc: string,
      placeholder: string,
    ) => {
      const cfg = fm[key];
      let textRef: TextComponent;

      new Setting(parent)
        .setName(label)
        .setDesc(desc)
        .addToggle((t) =>
          t
            .setValue(Boolean(cfg.enabled))
            .onChange(async (val) => {
              cfg.enabled = val;
              if (textRef) textRef.setDisabled(!val);
              await this.plugin.saveSettings();
            }),
        )
        .addText((t) => {
          textRef = t;
          t.setPlaceholder(placeholder)
            .setValue(cfg.property)
            .setDisabled(!cfg.enabled)
            .onChange(async (v) => {
              const trimmed = v.trim();
              cfg.property = trimmed.length > 0 ? trimmed : placeholder;
              await this.plugin.saveSettings();
            });
        });
    };

    addFrontmatterSetting(
      fmBody,
      'rating',
      'Rating',
      'Write the current Elo rating to this frontmatter property.',
      'eloRating',
    );
    addFrontmatterSetting(
      fmBody,
      'rank',
      'Rank',
      'Write the rank (1 = highest) within the cohort to this frontmatter property.',
      'eloRank',
    );
    addFrontmatterSetting(
      fmBody,
      'matches',
      'Matches',
      'Write the total number of matches to this frontmatter property.',
      'eloMatches',
    );
    addFrontmatterSetting(
      fmBody,
      'wins',
      'Wins',
      'Write the number of wins to this frontmatter property.',
      'eloWins',
    );

    // Convergence heuristics accordion
    const hs = this.plugin.settings.heuristics;
    const defaults = DEFAULT_SETTINGS.heuristics;

    const adv = containerEl.createEl('details', { cls: 'elo-settings-accordion' });
    adv.open = false;

    adv.createEl('summary', { text: 'Convergence heuristics' });
    const advBody = adv.createEl('div', { cls: 'elo-settings-body' });
    advBody.createEl('p', {
      text:
        'Optional tweaks that help new notes stabilise quickly and move ratings faster when results are more informative.',
    });

    // Provisional K boost
    new Setting(advBody).setName('Provisional K boost').setHeading();
    advBody.createEl('p', {
      text:
        'Use a higher K-factor for a note\'s first N matches to place new notes quickly. ' +
        'This is applied per note, per cohort.',
    });

    let provMatchesSlider: SliderComponent;
    let provMultSlider: SliderComponent;

    new Setting(advBody)
      .setName('Enable provisional boost')
      .setDesc(`Default: ${defaults.provisional.enabled ? 'On' : 'Off'}.`)
      .addToggle((t) =>
        t.setValue(hs.provisional.enabled).onChange(async (v) => {
          hs.provisional.enabled = v;
          await this.plugin.saveSettings();
          provMatchesSlider?.setDisabled(!v);
          provMultSlider?.setDisabled(!v);
        }),
      );

    new Setting(advBody)
      .setName('Provisional period (matches)')
      .setDesc(`Applies while the note has played fewer than N matches. Default: ${defaults.provisional.matches}.`)
      .addSlider((sl) => {
        provMatchesSlider = sl;
        sl.setLimits(1, 30, 1)
          .setValue(Math.max(1, Math.min(30, hs.provisional.matches)))
          .setDynamicTooltip()
          .onChange(async (value) => {
            hs.provisional.matches = Math.round(value);
            await this.plugin.saveSettings();
          })
          .setDisabled(!hs.provisional.enabled);
      });

    new Setting(advBody)
      .setName('Provisional K multiplier')
      .setDesc(`Multiplier on K during the provisional period. 1.0 disables the boost. Default: ${defaults.provisional.multiplier}.`)
      .addSlider((sl) => {
        provMultSlider = sl;
        sl.setLimits(1.0, 3.0, 0.05)
          .setValue(Math.max(1.0, Math.min(3.0, hs.provisional.multiplier)))
          .setDynamicTooltip()
          .onChange(async (value) => {
            hs.provisional.multiplier = Math.max(1.0, Math.min(3.0, value));
            await this.plugin.saveSettings();
          })
          .setDisabled(!hs.provisional.enabled);
      });

    // Decay with experience
    new Setting(advBody).setName('Decay K with experience').setHeading();
    advBody.createEl('p', {
      text:
        'Gradually reduce K as a note plays more matches, stabilising mature ratings. ' +
        'Effective K follows k = baseK / (1 + matches / halfLife).',
    });

    let halfSlider: SliderComponent | undefined;

    new Setting(advBody)
      .setName('Enable K decay')
      .setDesc(`Default: ${defaults.decay.enabled ? 'On' : 'Off'}.`)
      .addToggle((t) =>
        t.setValue(hs.decay.enabled).onChange(async (v) => {
          hs.decay.enabled = v;
          await this.plugin.saveSettings();
          halfSlider?.setDisabled(!v);
          minKSlider?.setDisabled(!v);
        }),
      );

    new Setting(advBody)
      .setName('Half-life (matches)')
      .setDesc(`At this many matches, the effective K is half of your base K. Default: ${defaults.decay.halfLife}.`)
      .addSlider((sl) => {
        halfSlider = sl;
        sl.setLimits(10, 500, 5)
          .setValue(Math.max(10, Math.min(500, hs.decay.halfLife)))
          .setDynamicTooltip()
          .onChange(async (value) => {
            hs.decay.halfLife = Math.round(value);
            await this.plugin.saveSettings();
          })
          .setDisabled(!hs.decay.enabled);
      });

    new Setting(advBody)
      .setName('Minimum K')
      .setDesc(`Lower bound on K for very experienced notes. Tip: keep this ≤ your base K (currently ${this.plugin.settings.kFactor}). Default: ${defaults.decay.minK}.`)
      .addSlider((sl) => {
        // Clamp the slider's max to the current base K on creation
        minKSlider = sl;
        sl.setLimits(4, this.plugin.settings.kFactor, 1)
          .setValue(Math.max(4, Math.min(this.plugin.settings.kFactor, hs.decay.minK)))
          .setDynamicTooltip()
          .onChange(async (v) => {
            hs.decay.minK = Math.round(Math.max(4, Math.min(this.plugin.settings.kFactor, v)));
            await this.plugin.saveSettings();
          })
          .setDisabled(!hs.decay.enabled);
      });

    // Upset boost
    new Setting(advBody).setName('Upset boost').setHeading();
    advBody.createEl('p', {
      text:
        'Increase K when a significantly lower-rated note wins. This helps ratings correct faster after surprises. ' +
        'Both sides receive the multiplier for the qualifying match.',
    });

    let upsetGapSlider: SliderComponent;
    let upsetMultSlider: SliderComponent;

    new Setting(advBody)
      .setName('Enable upset boost')
      .setDesc(`Default: ${defaults.upsetBoost.enabled ? 'On' : 'Off'}.`)
      .addToggle((t) =>
        t.setValue(hs.upsetBoost.enabled).onChange(async (v) => {
          hs.upsetBoost.enabled = v;
          await this.plugin.saveSettings();
          upsetGapSlider?.setDisabled(!v);
          upsetMultSlider?.setDisabled(!v);
        }),
      );

    new Setting(advBody)
      .setName('Upset gap threshold')
      .setDesc(`Minimum pre-match rating gap for an underdog win to qualify. Default: ${defaults.upsetBoost.threshold}.`)
      .addSlider((sl) => {
        upsetGapSlider = sl;
        sl.setLimits(50, 600, 25)
          .setValue(Math.max(0, Math.min(600, hs.upsetBoost.threshold)))
          .setDynamicTooltip()
          .onChange(async (value) => {
            hs.upsetBoost.threshold = Math.round(value);
            await this.plugin.saveSettings();
          })
          .setDisabled(!hs.upsetBoost.enabled);
      });

    new Setting(advBody)
      .setName('Upset K multiplier')
      .setDesc(`Multiplier applied when the underdog wins. Default: ${defaults.upsetBoost.multiplier}.`)
      .addSlider((sl) => {
        upsetMultSlider = sl;
        sl.setLimits(1.0, 3, 0.05)
          .setValue(Math.max(1.0, Math.min(3, hs.upsetBoost.multiplier)))
          .setDynamicTooltip()
          .onChange(async (value) => {
            hs.upsetBoost.multiplier = Math.max(1.0, Math.min(3.0, value));
            await this.plugin.saveSettings();
          })
          .setDisabled(!hs.upsetBoost.enabled);
      });

    // Big-gap draw boost
    new Setting(advBody).setName('Big-gap draw boost').setHeading();
    advBody.createEl('p', {
      text:
        'Increase K for draws across a large rating gap. A draw here suggests the ratings should move. ' +
        'Both sides receive the multiplier for the qualifying draw.',
    });

    let drawGapSlider: SliderComponent;
    let drawMultSlider: SliderComponent;

    new Setting(advBody)
      .setName('Enable big-gap draw boost')
      .setDesc(`Default: ${defaults.drawGapBoost.enabled ? 'On' : 'Off'}.`)
      .addToggle((t) =>
        t.setValue(hs.drawGapBoost.enabled).onChange(async (v) => {
          hs.drawGapBoost.enabled = v;
          await this.plugin.saveSettings();
          drawGapSlider?.setDisabled(!v);
          drawMultSlider?.setDisabled(!v);
        }),
      );

    new Setting(advBody)
      .setName('Draw gap threshold')
      .setDesc(`Minimum pre-match rating gap for a draw to qualify. Default: ${defaults.drawGapBoost.threshold}.`)
      .addSlider((sl) => {
        drawGapSlider = sl;
        sl.setLimits(50, 800, 25)
          .setValue(Math.max(0, Math.min(800, hs.drawGapBoost.threshold)))
          .setDynamicTooltip()
          .onChange(async (value) => {
            hs.drawGapBoost.threshold = Math.round(value);
            await this.plugin.saveSettings();
          })
          .setDisabled(!hs.drawGapBoost.enabled);
      });

    new Setting(advBody)
      .setName('Draw K multiplier')
      .setDesc(`Multiplier applied to both sides for qualifying draws. Default: ${defaults.drawGapBoost.multiplier}.`)
      .addSlider((sl) => {
        drawMultSlider = sl;
        sl.setLimits(1.0, 3.0, 0.05)
          .setValue(Math.max(1.0, Math.min(3.0, hs.drawGapBoost.multiplier)))
          .setDynamicTooltip()
          .onChange(async (value) => {
            hs.drawGapBoost.multiplier = Math.max(1.0, Math.min(3.0, value));
            await this.plugin.saveSettings();
          })
          .setDisabled(!hs.drawGapBoost.enabled);
      });

    // Matchmaking heuristics accordion
    const mm = this.plugin.settings.matchmaking;
    const mmDefaults = DEFAULT_SETTINGS.matchmaking;

    const mmAcc = containerEl.createEl('details', { cls: 'elo-settings-accordion' });
    mmAcc.open = false;
    mmAcc.createEl('summary', { text: 'Matchmaking heuristics' });
    const mmBody = mmAcc.createEl('div', { cls: 'elo-settings-body' });
    mmBody.createEl('p', {
      text:
        'Control how pairs are chosen. These heuristics can speed up convergence by focusing on informative comparisons.',
    });

    // Top-level enable
    new Setting(mmBody)
      .setName('Enable matchmaking heuristics')
      .setDesc(`Globally enable the pair selection heuristics. Default: ${mmDefaults.enabled ? 'On' : 'Off'}.`)
      .addToggle((t) =>
        t.setValue(mm.enabled).onChange(async (v) => {
          mm.enabled = v;
          await this.plugin.saveSettings();
        }),
      );

    // Similar ratings
    new Setting(mmBody).setName('Prefer similar ratings').setHeading();
    mmBody.createEl('p', {
      text:
        'When choosing an opponent, sample several candidates and pick the closest rating to the anchor note.',
    });

    let sampleSlider: SliderComponent;

    new Setting(mmBody)
      .setName('Enable similar-ratings selection')
      .setDesc(`Default: ${mmDefaults.similarRatings.enabled ? 'On' : 'Off'}.`)
      .addToggle((t) =>
        t.setValue(mm.similarRatings.enabled).onChange(async (v) => {
          mm.similarRatings.enabled = v;
          await this.plugin.saveSettings();
          sampleSlider?.setDisabled(!v);
        }),
      );

    new Setting(mmBody)
      .setName('Opponent sample size')
      .setDesc(`How many candidates to consider when picking the closest rating. Default: ${mmDefaults.similarRatings.sampleSize}.`)
      .addSlider((sl) => {
        sampleSlider = sl;
        sl.setLimits(5, 50, 1)
          .setValue(Math.max(5, Math.min(50, mm.similarRatings.sampleSize)))
          .setDynamicTooltip()
          .onChange(async (value) => {
            mm.similarRatings.sampleSize = Math.round(value);
            await this.plugin.saveSettings();
          })
          .setDisabled(!mm.similarRatings.enabled);
      });

    // Low matches bias
    new Setting(mmBody).setName('Bias towards fewer matches').setHeading();
    mmBody.createEl('p', {
      text:
        'Prefer notes with fewer matches as the anchor. Weight ≈ 1 / (1 + matches)^strength.',
    });

    let exponentSlider: SliderComponent;

    new Setting(mmBody)
      .setName('Enable low-matches bias')
      .setDesc(`Default: ${mmDefaults.lowMatchesBias.enabled ? 'On' : 'Off'}.`)
      .addToggle((t) =>
        t.setValue(mm.lowMatchesBias.enabled).onChange(async (v) => {
          mm.lowMatchesBias.enabled = v;
          await this.plugin.saveSettings();
          exponentSlider?.setDisabled(!v);
        }),
      );

    new Setting(mmBody)
      .setName('Bias strength')
      .setDesc(`Higher values emphasise low-match notes more strongly. Default: ${mmDefaults.lowMatchesBias.exponent}.`)
      .addSlider((sl) => {
        exponentSlider = sl;
        sl.setLimits(0, 3, 0.1)
          .setValue(Math.max(0, Math.min(3, mm.lowMatchesBias.exponent)))
          .setDynamicTooltip()
          .onChange(async (value) => {
            mm.lowMatchesBias.exponent = Math.max(0, Math.min(3, value));
            await this.plugin.saveSettings();
          })
          .setDisabled(!mm.lowMatchesBias.enabled);
      });

    // Upset probes
    new Setting(mmBody).setName('Occasional upset probes').setHeading();
    mmBody.createEl('p', {
      text:
        'Every so often, schedule a high-gap pair to detect surprises earlier.',
    });

    let probeProbSlider: SliderComponent;
    let probeGapSlider: SliderComponent;

    new Setting(mmBody)
      .setName('Enable upset probes')
      .setDesc(`Default: ${mmDefaults.upsetProbes.enabled ? 'On' : 'Off'}.`)
      .addToggle((t) =>
        t.setValue(mm.upsetProbes.enabled).onChange(async (v) => {
          mm.upsetProbes.enabled = v;
          await this.plugin.saveSettings();
          probeProbSlider?.setDisabled(!v);
          probeGapSlider?.setDisabled(!v);
        }),
      );

    new Setting(mmBody)
      .setName('Probe probability')
      .setDesc(`Chance of picking a high-gap opponent instead of a similar one. Default: ${(mmDefaults.upsetProbes.probability * 100).toFixed(0)}%.`)
      .addSlider((sl) => {
        probeProbSlider = sl;
        sl.setLimits(0, 50, 1)
          .setValue(Math.round(Math.max(0, Math.min(50, mm.upsetProbes.probability * 100))))
          .setDynamicTooltip()
          .onChange(async (value) => {
            mm.upsetProbes.probability = Math.max(0, Math.min(50, value)) / 100;
            await this.plugin.saveSettings();
          })
          .setDisabled(!mm.upsetProbes.enabled);
      });

    new Setting(mmBody)
      .setName('Minimum gap (rating)')
      .setDesc(`Only consider an upset probe if the candidate gap is at least this large. Default: ${mmDefaults.upsetProbes.minGap}.`)
      .addSlider((sl) => {
        probeGapSlider = sl;
        sl.setLimits(100, 800, 25)
          .setValue(Math.max(0, Math.min(800, mm.upsetProbes.minGap)))
          .setDynamicTooltip()
          .onChange(async (value) => {
            mm.upsetProbes.minGap = Math.round(value);
            await this.plugin.saveSettings();
          })
          .setDisabled(!mm.upsetProbes.enabled);
      });
  }

  private async deleteCohortWithConfirm(cohortKey: string): Promise<void> {
    const def = this.plugin.dataStore.getCohortDef(cohortKey);
    const label = def ? (def.label ?? prettyCohortDefinition(def)) : 'Cohort';

    const ok = await new DeleteCohortModal(this.app, label).openAndConfirm();
    if (!ok) return;

    // Remove data and definition
    const store = this.plugin.dataStore.store;
    if (store.cohorts && store.cohorts[cohortKey]) {
      delete store.cohorts[cohortKey];
    }
    if (store.cohortDefs && store.cohortDefs[cohortKey]) {
      delete store.cohortDefs[cohortKey];
    }
    if (store.lastUsedCohortKey === cohortKey) {
      store.lastUsedCohortKey = undefined;
    }
    await this.plugin.dataStore.saveStore();

    new Notice(`Deleted cohort: ${label}`);
    this.display();
  }

  private async configureCohort(cohortKey: string): Promise<void> {
    const def = this.plugin.dataStore.getCohortDef(cohortKey);
    if (!def) return;

    const res = await new CohortOptionsModal(this.app, this.plugin, {
      mode: 'edit',
      initial: def.frontmatterOverrides,
      initialName: def.label ?? '',
    }).openAndGetOptions();

    if (!res) return;

    const overrides = res.overrides ?? {};

    // Compute old vs new effective config, then save new overrides and name
    const base = this.plugin.settings.frontmatterProperties;
    const oldEffective = effectiveFrontmatterProperties(base, def.frontmatterOverrides);
    const newEffective = effectiveFrontmatterProperties(base, overrides);

    // Persist overrides (clear if no keys) and label (name)
    const hasKeys = Object.keys(overrides).length > 0;
    def.frontmatterOverrides = hasKeys ? overrides : undefined;

    const newName = (res.name ?? '').trim();
    def.label = newName.length > 0 ? newName : undefined;

    this.plugin.dataStore.upsertCohortDef(def);
    await this.plugin.dataStore.saveStore();
    this.display(); // refresh UI

    // Determine changes that require optional bulk updates
    const changed: Array<{
      key: PropKey;
      action: 'rename' | 'remove' | 'upsert';
      oldProp?: string;
      newProp?: string;
    }> = [];

    const keys: PropKey[] = ['rating', 'rank', 'matches', 'wins'];
    for (const key of keys) {
      const oldCfg = oldEffective[key];
      const newCfg = newEffective[key];

      if (oldCfg.enabled && !newCfg.enabled) {
        changed.push({ key, action: 'remove', oldProp: oldCfg.property });
        continue;
      }
      if (newCfg.enabled && oldCfg.enabled && oldCfg.property !== newCfg.property) {
        changed.push({ key, action: 'rename', oldProp: oldCfg.property, newProp: newCfg.property });
        continue;
      }
      if (!oldCfg.enabled && newCfg.enabled) {
        changed.push({ key, action: 'upsert', newProp: newCfg.property });
        continue;
      }
    }

    if (changed.length === 0) return;

    const files = resolveFilesForCohort(this.app, def);
    if (files.length === 0) return;

    const cohort: CohortData | undefined = this.plugin.dataStore.store.cohorts[cohortKey];
    const valuesFor = (key: PropKey): Map<string, number> => {
      const map = new Map<string, number>();
      if (!cohort) return map;
      if (key === 'rank') {
        const rankMap = computeRankMap(cohort);
        for (const [id, rank] of rankMap) map.set(id, rank);
      } else if (key === 'rating') {
        for (const [id, p] of Object.entries(cohort.players)) map.set(id, Math.round(p.rating));
      } else if (key === 'matches') {
        for (const [id, p] of Object.entries(cohort.players)) map.set(id, p.matches);
      } else if (key === 'wins') {
        for (const [id, p] of Object.entries(cohort.players)) map.set(id, p.wins);
      }
      return map;
    };

    // Run prompts sequentially
    for (const change of changed) {
      const key = change.key;
      const vals = valuesFor(key);

      if (change.action === 'remove' && change.oldProp) {
        const preview = await previewCohortFrontmatterPropertyUpdates(
          this.app,
          files,
          new Map(),
          '',
          change.oldProp,
        );
        if (preview.wouldUpdate === 0) continue;

        const ok = await new ConfirmModal(
          this.app,
          'Remove cohort property?',
          `Remove frontmatter property "${change.oldProp}" from ${preview.wouldUpdate} notes in this cohort?`,
          'Yes, remove',
          'No, don\'t update'
        ).openAndConfirm();
        if (!ok) continue;

        const res = await updateCohortFrontmatter(
          this.app,
          files,
          new Map(),
          '',
          change.oldProp,
          `Removing "${change.oldProp}" from ${preview.wouldUpdate} notes...`,
        );
        new Notice(`Removed "${change.oldProp}" from ${res.updated} notes.`);
      } else if (change.action === 'rename' && change.oldProp && change.newProp) {
        const preview = await previewCohortFrontmatterPropertyUpdates(
          this.app,
          files,
          vals,
          change.newProp,
          change.oldProp,
        );
        if (preview.wouldUpdate === 0) continue;

        const ok = await new ConfirmModal(
          this.app,
          'Rename cohort property?',
          `Rename frontmatter property "${change.oldProp}" to "${change.newProp}" on ${preview.wouldUpdate} notes in this cohort?`,
          'Yes, rename',
          'No, don\'t rename'
        ).openAndConfirm();
        if (!ok) continue;

        const res = await updateCohortFrontmatter(
          this.app,
          files,
          vals,
          change.newProp,
          change.oldProp,
          `Renaming "${change.oldProp}" to "${change.newProp}" on ${preview.wouldUpdate} notes...`,
        );
        new Notice(`Updated ${res.updated} notes.`);
      } else if (change.action === 'upsert' && change.newProp) {
        const preview = await previewCohortFrontmatterPropertyUpdates(
          this.app,
          files,
          vals,
          change.newProp,
        );
        if (preview.wouldUpdate === 0) continue;

        const ok = await new ConfirmModal(
          this.app,
          'Write cohort property?',
          `Write frontmatter property "${change.newProp}" to ${preview.wouldUpdate} notes in this cohort?`,
          'Yes, write',
          'No, don\'t write'
        ).openAndConfirm();
        if (!ok) continue;

        const res = await updateCohortFrontmatter(
          this.app,
          files,
          vals,
          change.newProp,
          undefined,
          `Writing "${change.newProp}" to ${preview.wouldUpdate} notes...`,
        );
        new Notice(`Wrote "${change.newProp}" on ${res.updated} notes.`);
      }
    }
  }
}
