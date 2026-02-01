import { globalIgnores } from 'eslint/config';
import globals from 'globals';
import obsidianmd from 'eslint-plugin-obsidianmd';
import prettierConfig from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';

const tsFiles = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];

// Ensure type-aware rules never run on JSON (or JS)
const typeCheckedTsOnly = tseslint.configs.recommendedTypeChecked.map((c) => ({
  ...c,
  files: tsFiles,
}));

export default tseslint.config(
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mjs', 'manifest.json'],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json'],
      },
    },
  },

  // Obsidian-specific linting (UI text, etc)
  ...obsidianmd.configs.recommended,

  ...typeCheckedTsOnly,

  {
    files: tsFiles,
    plugins: {
      obsidianmd,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      'obsidianmd/ui/sentence-case': [
        'warn',
        {
          brands: ['Elo', 'Markdown', 'Obsidian', 'Command palette', 'Pairwise Elo Ranking'],
          acronyms: ['ID', 'K'],
        },
      ],

      // ---- Promise discipline ----
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            arguments: false,
            attributes: false,
          },
        },
      ],

      // ---- Imports + dead code ----
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],

      'simple-import-sort/imports': 'warn',
      'simple-import-sort/exports': 'warn',

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      '@typescript-eslint/no-empty-function': ['warn', { allow: ['arrowFunctions'] }],
    },
  },

  // Node globals for config/build scripts
  {
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  prettierConfig,

  globalIgnores([
    'node_modules',
    'dist',
    'main.js',
    'versions.json',
    'esbuild.config.mjs',
    'version-bump.mjs',
  ]),
);
