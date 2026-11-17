export default [{
  files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
  languageOptions: { ecmaVersion: 'latest' },
  rules: {
    'array-callback-return': 'error',
    'no-cond-assign': 'error',
    'no-constant-binary-expression': 'error',
    'no-dupe-keys': 'error',
    'no-empty': 'warn',
    'no-fallthrough': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
  },
}]
