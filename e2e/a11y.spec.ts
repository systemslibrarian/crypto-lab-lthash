import { expect, test } from '@playwright/test';
import {
  NARROW,
  boot,
  driveAllStates,
  expectBaselineNotStale,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state with the
 * update exhibit already computed and five tabpanels hidden and UNRENDERED; the
 * shared skip link focused; an item added and removed with its vector and the
 * changed digest words on screen; the duplicate and empty-item refusals; multiset
 * mode and a never-added removal; the smallest and widest reduced instances; the
 * deployed instance with its reference checksum, its WebCrypto second opinion and
 * a malformed digest refused; the elimination replayed a step at a time and run
 * to its highlighted subset; the full recursion from a first cancelled bit to a
 * zero digest and two alarm verdicts, then a size over the cap refused; the
 * two-bit recursion pending, run, and run again at an odd modulus; the
 * negative-claim fixture and its rebuild; every disclosure and quick check opened
 * through its own summary and answered wrong and then right; three hover states
 * and a focus ring. Every one of those states is scanned, at desktop and phone
 * width.
 *
 * See `gate.ts` for why nothing is injected into the page, why no panel is
 * revealed from script, why the lab's defaults are asserted rather than assumed,
 * and why `violations` is not the whole oracle.
 */
test('no WCAG A/AA violations in the dark theme', async ({ page }) => {
  test.setTimeout(1_800_000);
  const errors = watchPageErrors(page);
  await boot(page);
  await driveAllStates(page, 'dark');
  expect(errors, errors.join('\n')).toEqual([]);
  expectBaselineNotStale();
  reportCollected();
});

test('no WCAG A/AA violations in the dark theme at 380px', async ({ page }) => {
  test.setTimeout(1_800_000);
  const errors = watchPageErrors(page);
  await page.setViewportSize(NARROW);
  await boot(page);
  await driveAllStates(page, 'dark @380px');
  expect(errors, errors.join('\n')).toEqual([]);
  expectBaselineNotStale();
  reportCollected();
});
