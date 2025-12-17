import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'drizzle/**'],
  rules: {
    // Allow unused variables that start with underscore (common pattern for intentionally unused params)
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
  },
});
