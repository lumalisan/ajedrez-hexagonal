export default {
  '*.{js,mjs,cjs,ts,tsx,mts,cts}': ['eslint --fix', 'prettier --write'],
  '*.{css,html,json,md,yaml,yml}': 'prettier --write',
  // The function prevents lint-staged from appending filenames to the project-wide check.
  '{*.{ts,tsx,mts,cts},package.json,tsconfig*.json,lint-staged.config.mjs}': () =>
    'npm run test:types',
};
