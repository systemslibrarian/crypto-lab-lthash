import { configDefaults, defineConfig } from 'vitest/config';

// base must match the GitHub Pages project subpath:
// https://systemslibrarian.github.io/crypto-lab-lthash/
export default defineConfig({
  base: '/crypto-lab-lthash/',
  test: {
    // Colocated unit tests only; the Playwright specs in e2e/ are not Vitest tests.
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // The (8, 6) recursion issues 531,441 BLAKE2Xb queries, which is seconds of
    // real work rather than a hang. Vitest 4+ enforces ELAPSED time, so the
    // budget carries the measurement rather than shrinking what the test does —
    // see the per-test timeouts in src/attack/onebit.test.ts.
    testTimeout: 30_000,
  },
});
