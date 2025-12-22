// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		plugins: {
			'@stylistic': stylistic
		},
		rules: {
			'@stylistic/semi': ['error', 'always'],
			'@stylistic/indent': ['error', 'tab'],
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/no-explicit-any': 'warn'
		}
	},
	{
		ignores: ['dist/**', 'out/**', 'node_modules/**', 'esbuild.js']
	}
);
