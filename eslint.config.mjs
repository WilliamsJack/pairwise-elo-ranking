import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

const compat = new FlatCompat({ baseDirectory: process.cwd() });

const normalisePluginConfigs = (cfgs) => {
  const arr = Array.isArray(cfgs) ? cfgs : cfgs ? [cfgs] : [];
  return arr.flatMap((cfg) => {
    if (!cfg || typeof cfg !== "object") return [];
    if ("extends" in cfg) return compat.config(cfg);
    if ("rules" in cfg || "plugins" in cfg || "languageOptions" in cfg || "ignores" in cfg || "files" in cfg) return [cfg];
    const ruleKeys = Object.keys(cfg).filter((k) => k.includes("/"));
    if (ruleKeys.length) return [{ rules: cfg }];
    return [cfg];
  });
};

export default [
  { ignores: ["node_modules/", "main.js"] },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname
      }
    }
  },

  ...tseslint.configs.recommendedTypeChecked,

  { plugins: { obsidianmd } },

  ...normalisePluginConfigs(obsidianmd.configs?.recommended),

  {
    languageOptions: { parserOptions: { sourceType: "module" } },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
      "@typescript-eslint/ban-ts-comment": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-empty-function": "off",
      'obsidianmd/ui/sentence-case': ['warn', {
        brands: ['Elo', 'Markdown', 'Obsidian', 'Command palette'],
        acronyms: ['ID', 'K']
      }]
    }
  }
];
