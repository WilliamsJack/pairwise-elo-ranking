import type { StarMapping, StarScaleConfig } from './settings';

// Single source of truth for the names and descriptions of every frontmatter
// property the plugin can write. Both surfaces that render these settings read
// from here so their copy cannot drift:
//   - the global settings page (declarative, in SettingsTab.ts)
//   - the per-cohort options modal (imperative, via FrontmatterPropertyRow.ts
//     and StarScaleRow.ts)

export type FmSimpleKey = 'rating' | 'uncertainty' | 'rank' | 'matches' | 'wins';

export const FM_SIMPLE_KEYS: readonly FmSimpleKey[] = [
  'rating',
  'uncertainty',
  'rank',
  'matches',
  'wins',
] as const;

interface SimpleCopy {
  // Group heading on the global page; also the single-row name in the cohort modal.
  label: string;
  // Name of the enable toggle on the global page (where the toggle is its own row).
  toggleName: string;
  // Description of the enable toggle/combined row
  toggleDesc: string;
  // Description of the "Property name" row on the global page.
  nameDesc: string;
}

interface FieldCopy {
  name: string;
  desc: string;
}

interface StarCopy extends SimpleCopy {
  // Extra controls unique to the star scale.
  fields: {
    max: FieldCopy;
    allowZero: FieldCopy;
    mode: FieldCopy;
    decimals: FieldCopy;
    mapping: FieldCopy;
  };
}

export const PROPERTY_NAME_LABEL = 'Property name';

export const FM_SIMPLE_COPY: Record<FmSimpleKey, SimpleCopy> = {
  rating: {
    label: 'Rating',
    toggleName: 'Write rating to frontmatter',
    toggleDesc: 'Write the current Glicko rating to a frontmatter property.',
    nameDesc: 'Frontmatter property used to store the rating.',
  },
  uncertainty: {
    label: 'Uncertainty',
    toggleName: 'Write uncertainty to frontmatter',
    toggleDesc:
      'Write how uncertain the rating is. Starts high and decreases as more comparisons are made.',
    nameDesc: 'Frontmatter property used to store the uncertainty.',
  },
  rank: {
    label: 'Rank',
    toggleName: 'Write rank to frontmatter',
    toggleDesc: 'Write the cohort rank (1 = highest) to a frontmatter property.',
    nameDesc: 'Frontmatter property used to store the rank.',
  },
  matches: {
    label: 'Matches',
    toggleName: 'Write match count to frontmatter',
    toggleDesc: 'Write the number of matches played to a frontmatter property.',
    nameDesc: 'Frontmatter property used to store the match count.',
  },
  wins: {
    label: 'Wins',
    toggleName: 'Write win count to frontmatter',
    toggleDesc: 'Write the number of wins to a frontmatter property.',
    nameDesc: 'Frontmatter property used to store the win count.',
  },
};

export const FM_STARS_COPY: StarCopy = {
  label: 'Star rating',
  toggleName: 'Write a star rating to frontmatter',
  toggleDesc:
    "Write a derived n-star rating (e.g. 1-7) to frontmatter, based on each note's position in the cohort.",
  nameDesc: 'Frontmatter property used to store the star rating.',
  fields: {
    max: {
      name: 'Maximum stars',
      desc: 'The highest value on the scale (N).',
    },
    allowZero: {
      name: 'Allow zero',
      desc: 'Let the scale start at 0 instead of 1 (e.g. 0-5 rather than 1-5).',
    },
    mode: {
      name: 'Number type',
      desc: 'Write whole numbers, or allow fractional star ratings.',
    },
    decimals: {
      name: 'Decimal places',
      desc: 'Precision used for fractional star ratings.',
    },
    mapping: {
      name: 'Mapping',
      desc: 'By rating spreads notes according to their rating gaps; by rank spreads them evenly across the scale.',
    },
  },
};

// Option labels for the star scale dropdowns.
export const STAR_MODE_LABELS: Record<StarScaleConfig['mode'], string> = {
  integer: 'Whole numbers',
  float: 'Decimals',
};

export const STAR_MAPPING_LABELS: Record<StarMapping, string> = {
  rating: 'By rating (spread by score)',
  rank: 'By rank (even spread)',
};
