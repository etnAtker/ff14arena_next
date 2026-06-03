module.exports = {
  '*.{ts,tsx,cts,mts,vue,js,mjs,cjs}': [
    'corepack pnpm exec eslint --fix',
    'corepack pnpm exec prettier --write',
  ],
  '*.{json,md,yml,yaml}': ['corepack pnpm exec prettier --write'],
};
