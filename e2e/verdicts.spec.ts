import { expect, test, type Page } from '@playwright/test';
import { expectVerdict } from './expect-verdict.js';

/**
 * One test per `data-verdict` marker, asserting what that marker renders AND the
 * state it paints, together, through `expectVerdict`.
 *
 * These are the assertions the recorded mutations in e2e/verdict-mutations.json
 * must break. Keeping them one-to-one with the markers is what makes a kill
 * legible: when a mutation is applied, the failure is that verdict's own
 * assertion rather than a build error, a blank page, or the suite going red.
 *
 * Text alone is not enough and the helper refuses it. A mutation that flipped the
 * words while leaving `data-result="pass"` in place would otherwise be recorded
 * as a kill, and the marker would go on claiming success in every way a reader
 * can see except the sentence.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app')).not.toBeEmpty();
});

const openTab = async (page: Page, name: RegExp, panel: string): Promise<void> => {
  await page.getByRole('tab', { name }).click();
  await expect(page.locator(panel)).not.toBeEmpty();
};

test('update-consistency compares the running digest with a full recomputation', async ({ page }) => {
  await expectVerdict(page, 'update-consistency', {
    contains: 'MATCH',
    absent: 'MISMATCH',
    result: 'pass',
    klass: /verdict-pass/,
  });
});

test('order-invariance compares the set hashed forwards and reversed', async ({ page }) => {
  await expectVerdict(page, 'order-invariance', {
    contains: 'IDENTICAL — the digest does not depend on the order the items arrived in',
    result: 'pass',
  });
});

test('remove-undoes-add compares the digest before and after a round trip', async ({ page }) => {
  await expectVerdict(page, 'remove-undoes-add', {
    contains: 'BACK TO THE START',
    absent: 'STILL DIFFERENT',
    result: 'pass',
  });
});

test('folly-vector reports the comparison against the reference checksum', async ({ page }) => {
  await openTab(page, /The Real One/, '#panel-deployed');
  await expectVerdict(page, 'folly-vector', {
    contains: 'MATCHES THE REFERENCE',
    absent: 'DIFFERS',
    result: 'pass',
  });
});

test('folly-removal-undone reports the digest of the two items that remain', async ({ page }) => {
  await openTab(page, /The Real One/, '#panel-deployed');
  await expectVerdict(page, 'folly-removal-undone', {
    contains: 'IDENTICAL — adding and then removing "b" left no trace in any of the 1,024 words',
    result: 'pass',
  });
});

test('folly-sha256 reports what the browser SHA-256 said about those bytes', async ({ page }) => {
  await openTab(page, /The Real One/, '#panel-deployed');
  await expect(page.locator('[data-verdict="folly-sha256"]')).not.toHaveAttribute('data-result', 'pending');
  await expectVerdict(page, 'folly-sha256', {
    contains: 'SAME 32 BYTES',
    absent: 'DIFFERENT',
    result: 'pass',
  });
});

test('deployed-incremental compares twelve updates with a full recomputation', async ({ page }) => {
  await openTab(page, /The Real One/, '#panel-deployed');
  await expectVerdict(page, 'deployed-incremental', {
    contains: 'MATCH — the incrementally maintained digest equals the recomputed one in all 1,024 words',
    result: 'pass',
  });
});

test('digest-parse refuses a digest of the wrong length and names the cause', async ({ page }) => {
  await openTab(page, /The Real One/, '#panel-deployed');
  await page.locator('#deployed-check').click();
  await expectVerdict(page, 'digest-parse', {
    contains: ['REFUSED', '2048 bytes'],
    absent: 'ACCEPTED',
    result: 'fail',
  });
  // And accepts the whole thing, so the refusal is about the length rather than
  // about the field never being readable.
  const full = await page.locator('#deployed-digest').inputValue();
  await page.locator('#deployed-paste').fill(full);
  await page.locator('#deployed-check').click();
  await expectVerdict(page, 'digest-parse', { contains: 'ACCEPTED', result: 'pass' });
});

test('parity-cancelled reports whether the subset sum is even in every word', async ({ page }) => {
  await openTab(page, /Cancel One Bit/, '#panel-onebit');
  await expectVerdict(page, 'parity-cancelled', {
    contains: 'EVEN IN ALL 4 WORDS',
    absent: 'ODD SOMEWHERE',
    result: 'pass',
  });
});

test('collision-zero is the independent checker, not the recursion, reporting the zero', async ({ page }) => {
  await openTab(page, /Cancel Them All/, '#panel-recursion');
  // The checker has nothing to judge until every bit is cancelled, so the
  // pending state is the one that ships the moment there IS something to check.
  await page.locator('#recursion-all').click();
  await expectVerdict(page, 'collision-zero', { contains: 'Nothing checked yet', result: 'pending' });
  await page.locator('#recursion-check').click();
  await expectVerdict(page, 'collision-zero', {
    contains: ['ALL 4 WORDS ZERO', 'same digest as the empty set'],
    absent: 'NOT A COLLISION',
    result: 'alarm',
  });
});

test('collision-union reports the second pair, S union T against T', async ({ page }) => {
  await openTab(page, /Cancel Them All/, '#panel-recursion');
  await page.locator('#recursion-all').click();
  await page.locator('#recursion-check').click();
  await expectVerdict(page, 'collision-union', {
    contains: 'AND S ∪ T COLLIDES WITH T',
    absent: 'DID NOT COLLIDE',
    result: 'alarm',
  });
});

test('recursion-size refuses an instance whose query count is over the cap', async ({ page }) => {
  await openTab(page, /Cancel Them All/, '#panel-recursion');
  await page.selectOption('#recursion-size', '8,8');
  await expectVerdict(page, 'recursion-size', {
    contains: ['REFUSED', '43,046,721', '600,000'],
    result: 'fail',
  });
});

test('twobit-collision is the same checker judging the two-bit result', async ({ page }) => {
  await openTab(page, /Two Bits At A Time/, '#panel-twobit');
  await expectVerdict(page, 'twobit-collision', { contains: 'Nothing run yet', result: 'pending' });
  await page.locator('#twobit-run').click();
  await expectVerdict(page, 'twobit-collision', {
    contains: ['DIGESTS EQUAL IN ALL 6 WORDS', 're-hashed from scratch by the independent checker'],
    absent: 'NOT A COLLISION',
    result: 'alarm',
  });
});

test('the limit fixture reports both correctness checks on both sets', async ({ page }) => {
  await openTab(page, /Updates Correct/, '#panel-limit');
  for (const id of ['limit-consistent-s', 'limit-consistent-t']) {
    await expectVerdict(page, id, {
      contains: 'MATCH — the incremental digest equals Σ H(x) recomputed from scratch',
      absent: 'MISMATCH',
      result: 'pass',
    });
  }
  for (const id of ['limit-roundtrip-s', 'limit-roundtrip-t']) {
    await expectVerdict(page, id, {
      contains: 'ROUND-TRIPPED',
      absent: 'DID NOT ROUND-TRIP',
      result: 'pass',
    });
  }
});

test('limit-headline says both things at once: the digests match and the sets differ', async ({ page }) => {
  await openTab(page, /Updates Correct/, '#panel-limit');
  await expectVerdict(page, 'limit-headline', {
    contains: ['DIGESTS MATCH — AND THE SETS DIFFER', 'two sets that share no item'],
    absent: 'FIXTURE INVALID',
    result: 'alarm',
  });
});
