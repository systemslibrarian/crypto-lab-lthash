import { expect, test, type Locator, type Page } from '@playwright/test';
import { canonicalClaim, recordObservation, runId } from './observations.js';

/**
 * A marker's text and its state are ONE claim.
 *
 * Asserting the words alone would record a kill for a mutation that flips the
 * sentence while leaving `data-result="pass"` in place, and the marker would go
 * on claiming success in every way a reader can see except the sentence. So
 * `expectVerdict` asserts both in a single call and REFUSES a claim carrying
 * only one of them, which keeps the weak shape from being written by accident.
 *
 * Each call that passes then RECORDS itself — the test that ran it, the marker,
 * and the claim — into the run-scoped sink in e2e/observations.ts. Recording
 * happens AFTER the assertions, never before: "observed" means the claim
 * executed and held, not that a call was reached.
 */
export interface VerdictClaim {
  /** Assert against this descendant of the marker rather than the marker itself. */
  within?: string;
  text?: string;
  contains?: string | readonly string[];
  absent?: string | readonly string[];
  /** `data-result` on the marker (or on `within`). */
  result?: string;
  /** Class list of the marker (or of `within`). */
  klass?: RegExp;
}

const list = (value: string | readonly string[] | undefined): readonly string[] =>
  value === undefined ? [] : typeof value === 'string' ? [value] : value;

function observe(kind: 'verdict' | 'claim', id: string, claim: Readonly<Record<string, unknown>>): void {
  recordObservation({ run: runId(), test: test.info().title, kind, id, claim: canonicalClaim(claim) });
}

export async function expectVerdict(page: Page, id: string, ...claims: readonly VerdictClaim[]): Promise<void> {
  const marker = page.locator(`[data-verdict="${id}"]`);
  await expect(marker, `the page must render exactly one visible [data-verdict="${id}"]`).toHaveCount(1);
  expect(claims.length, `expectVerdict('${id}') was called with no claim`).toBeGreaterThan(0);

  for (const claim of claims) {
    const saysSomething = claim.text !== undefined || claim.contains !== undefined;
    const showsState = claim.result !== undefined || claim.klass !== undefined;
    expect(
      saysSomething && showsState,
      `expectVerdict('${id}') needs the rendered text AND the rendered state in the same claim; ` +
        'a text-only assertion cannot fail a mutation that leaves the styling saying pass',
    ).toBe(true);

    const target: Locator = claim.within ? marker.locator(claim.within) : marker;
    if (claim.text !== undefined) await expect(target).toHaveText(claim.text);
    for (const fragment of list(claim.contains)) await expect(target).toContainText(fragment);
    for (const fragment of list(claim.absent)) await expect(target).not.toContainText(fragment);
    if (claim.result !== undefined) await expect(target).toHaveAttribute('data-result', claim.result);
    if (claim.klass !== undefined) await expect(target).toHaveClass(claim.klass);

    observe('verdict', id, claim as unknown as Record<string, unknown>);
  }
}

/**
 * The same rule for a rendered measurement: the number a reader sees and the
 * machine value beside it are one claim, so a mutation has to move both.
 */
export interface MeasurementClaim {
  text?: string;
  contains?: string;
  value?: string;
}

export async function expectClaim(page: Page, id: string, claim: MeasurementClaim): Promise<void> {
  const marker = page.locator(`[data-claim="${id}"]`);
  await expect(marker, `the page must render exactly one [data-claim="${id}"]`).toHaveCount(1);
  expect(
    (claim.text !== undefined || claim.contains !== undefined) && claim.value !== undefined,
    `expectClaim('${id}') needs the rendered text AND the machine value in the same claim`,
  ).toBe(true);
  if (claim.text !== undefined) await expect(marker).toHaveText(claim.text);
  if (claim.contains !== undefined) await expect(marker).toContainText(claim.contains);
  if (claim.value !== undefined) await expect(marker).toHaveAttribute('data-value', claim.value);
  observe('claim', id, claim as Record<string, unknown>);
}
