import { configDefaults, defineConfig } from 'vitest/config';

// base must match the GitHub Pages project subpath:
// https://systemslibrarian.github.io/crypto-lab-lthash/
export default defineConfig({
  base: '/crypto-lab-lthash/',
  test: {
    // Colocated unit tests only; the Playwright specs in e2e/ are not Vitest tests.
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // The (8, 6) recursion issues 531,441 BLAKE2Xb queries; vitest 4+ enforces
    // elapsed time, so the budget carries the measurement rather than shrinking
    // what the test does (see the per-test timeouts in onebit.test.ts).
    testTimeout: 20_000,
  },
});
