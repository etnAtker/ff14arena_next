module.exports = {
  '*.{ts,tsx,cts,mts,vue,js,mjs,cjs}': ['pnpm exec eslint --fix', 'pnpm exec prettier --write'],
  '*.{json,md,yml,yaml}': ['pnpm exec prettier --write'],
};
