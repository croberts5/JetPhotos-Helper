const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
    { ignores: ['node_modules', '**/*.js'] },
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-explicit-any':  'warn',
            '@typescript-eslint/no-unused-vars':   ['error', { argsIgnorePattern: '^_' }],
        },
    }
);
