import { globalIgnores } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			'obsidianmd/ui/sentence-case': ['warn', {
				brands: ['Elo', 'Markdown', 'Obsidian', 'Command palette'],
				acronyms: ['ID', 'K']
			}]
		}
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
