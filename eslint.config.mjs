import { globalIgnores } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";
import prettierConfig from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";
import unusedImports from "eslint-plugin-unused-imports";

export default tseslint.config(
  globalIgnores([
    "node_modules",
    "dist",
    "main.js",
    "versions.json",
    "esbuild.config.mjs",
    "version-bump.mjs",
  ]),

  // TypeScript source
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["manifest.json"],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"],
      },
    },
    plugins: {
      "simple-import-sort": simpleImportSort,
      "unused-imports": unusedImports,
    },
  },

  // TypeScript ESLint - correctness
  ...tseslint.configs.recommendedTypeChecked,

  // Obsidian-specific linting (UI text, etc)
  ...obsidianmd.configs.recommended,
  {
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", {
        brands: ["Elo", "Markdown", "Obsidian", "Command palette"],
        acronyms: ["ID", "K"],
      }],

      // ---- Promise discipline ----
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/await-thenable": "error",

      "@typescript-eslint/no-misused-promises": ["error", {
        checksVoidReturn: {
          arguments: false,
          attributes: false,
        },
      }],

      // ---- Imports + dead code ----
      "unused-imports/no-unused-imports": "error",
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],

      "@typescript-eslint/consistent-type-imports": ["warn", {
        prefer: "type-imports",
        fixStyle: "separate-type-imports",
      }],

      "simple-import-sort/imports": "warn",
      "simple-import-sort/exports": "warn",

      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",

      "no-empty": ["warn", { allowEmptyCatch: true }],
      "@typescript-eslint/no-empty-function": ["warn", { allow: ["arrowFunctions"] }],
    },
  },

  {
    files: ["**/*.mjs", "**/*.cjs", "**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  prettierConfig,
);
