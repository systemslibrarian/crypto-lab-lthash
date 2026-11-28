import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { expectClaim } from './expect-verdict.js';

/**
 * The claims suite: what this lab's interface SAYS and MEASURES, as opposed to
 * what it is shaped like. §4.1b of the master template.
 *
 * The rule that makes these worth anything: compare two values the page itself
 * printed, or re-derive the claim from the page's raw inputs by a DIFFERENT
 * route than the source takes. A test that recomputes the same expression the
 * source uses will happily agree with a bug.
 *
 * So this file mixes three shapes:
 *   - cross-checks: a counter against the rows it counts, a set size against the
 *     number of items the checker re-hashed;
 *   - independent re-derivations: the homomorphism recomputed in the test from
 *     three rendered word strips; (N + 1)^d recomputed with BigInt from the N and
 *     d shown on screen; the SHA-256 of the deployed digest recomputed with
 *     node:crypto, which shares no code with anything in src/;
 *   - parts-sum-to-whole: the two colliding sets against the items re-hashed.
 *
 * It also covers each failure path, retirement, the no-op guard, the `[hidden]`
 * probe, and the negative claim of §4.1d.
 */

const openTab = async (page: Page, name: RegExp, panel: string): Promise<void> => {
  await page.getByRole('tab', { name }).click();
  await expect(page.locator(panel)).not.toBeEmpty();
};

/** The word values of the nth `ul.words` strip under a container, in order. */
async function stripWords(page: Page, container: string, index: number): Promise<number[]> {
  return page
    .locator(`${container} ul.words`)
    .nth(index)
    .locator('.word-val')
    .evaluateAll((cells) => cells.map((c) => Number((c.textContent ?? '').trim())));
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app')).not.toBeEmpty();
});

test.describe('displayed claims', () => {
  test('a user item can have the same name as the round-trip example', async ({ page }) => {
    await page.fill('#update-item', 'a-new-item');
    await page.click('#update-add');
    await expect(page.locator('[data-verdict="remove-undoes-add"]')).toContainText('BACK TO THE START');
    await expect(page.getByText('“a-new-item-2” is added', { exact: false })).toBeVisible();
  });

  test('order and round-trip panels use the same signed multiset as the maintained digest', async ({ page }) => {
    await page.getByRole('radio', { name: /signed-count arithmetic/ }).check();
    await page.fill('#update-item', 'duplicate');
    await page.click('#update-add');
    await page.click('#update-add');
    await page.fill('#update-item', 'debt');
    await page.click('#update-remove');
    const field = (name: string) => page.locator('.field').filter({ has: page.getByText(name, { exact: true }) }).locator('.field-value');
    const maintained = await field('maintained incrementally').innerText();
    for (const label of ['in order', 'reversed', 'after removing again']) {
      await expect(field(label)).toHaveText(maintained);
    }
  });

  test('the item box arrives holding this lab’s own example item', async ({ page }) => {
    await expect(page.locator('#update-item')).toHaveValue('dates');
  });

  test('the headline claim: the digest after an add is the digest before plus the item vector, recomputed here', async ({
    page,
  }) => {
    // The independent re-derivation. The page renders three strips — the digest
    // before, the item's vector, and the digest after — and the whole lesson is
    // that the third is the word-wise sum of the first two modulo 2^d. The test
    // adds them itself rather than asking the page to agree with itself.
    await page.fill('#update-item', 'figs');
    await page.locator('#update-add').click();
    await expect(page.locator('#update-last')).toContainText('figs');

    const strips = page.locator('#update-last ul.words');
    await expect(strips).toHaveCount(3);
    const before = await stripWords(page, '#update-last', 0);
    const vector = await stripWords(page, '#update-last', 1);
    const after = await stripWords(page, '#update-last', 2);

    const d = Number(await page.locator('#update-d').inputValue());
    const modulus = 2 ** d;
    expect(before.length).toBe(after.length);
    expect(vector.length).toBe(after.length);
    expect(after).toEqual(before.map((w, i) => (w + vector[i]) % modulus));
    // And every word really is reduced: a missing mask would show up here.
    expect(after.every((w) => w < modulus)).toBe(true);

    // Removing it again subtracts the same vector, modulo the same modulus.
    await page.locator('#update-remove').click();
    const back = await stripWords(page, '#update-last', 2);
    expect(back).toEqual(after.map((w, i) => (w - vector[i] + modulus) % modulus));
  });

  test('the word count claimed equals the number of word cells rendered', async ({ page }) => {
    for (const n of ['4', '12']) {
      await page.selectOption('#update-n', n);
      const cells = await page.locator('#update-current ul.words .word').count();
      expect(cells).toBe(Number(n));
      await expectClaim(page, 'update-word-count', { text: n, value: n });
    }
  });

  test('the query count claimed counts every call, including a repeat', async ({ page }) => {
    // Three items are added at mount. Adding a fourth, removing it and adding it
    // again is three more CALLS over two distinct items, and the counter counts
    // calls — a cache in front of it would answer a different question.
    await expectClaim(page, 'update-queries', { text: '3', value: '3' });
    await page.fill('#update-item', 'figs');
    await page.locator('#update-add').click();
    await page.locator('#update-remove').click();
    await page.locator('#update-add').click();
    await expectClaim(page, 'update-queries', { text: '6', value: '6' });
  });

  test('the deployed digest SHA-256 claimed is the SHA-256 node computes over the same hex', async ({ page }) => {
    await openTab(page, /The Real One/, '#panel-deployed');
    await expect(page.locator('[data-verdict="folly-sha256"]')).not.toHaveAttribute('data-result', 'pending');
    const hex = (await page.locator('#deployed-digest').inputValue()).trim();
    expect(hex).toHaveLength(4096);
    // node:crypto shares no code with src/: an independent route to the same
    // 32 bytes, over the 2,048 bytes this page actually produced.
    const digest = createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
    await expectClaim(page, 'sha256-computed', { contains: digest.slice(0, 16), value: digest });
    await expectClaim(page, 'sha256-recorded', { contains: digest.slice(0, 16), value: digest });
  });

  test('the four reference steps re-derive each other: step 4 is step 3 minus the vector step 2 added', async ({
    page,
  }) => {
    // A different route to the same arithmetic than the source takes. The table
    // prints the first four words of the digest after each step, so H("b") word
    // by word is (after step 2) − (after step 1), and (after step 4) must be
    // (after step 3) minus exactly that.
    await openTab(page, /The Real One/, '#panel-deployed');
    const rows = page.locator('#panel-deployed tbody tr');
    await expect(rows).toHaveCount(4);
    const read = async (i: number): Promise<number[]> =>
      ((await rows.nth(i).locator('td').nth(2).textContent()) ?? '')
        .split('·')
        .map((v) => Number(v.trim()));
    const [s1, s2, s3, s4] = [await read(0), await read(1), await read(2), await read(3)];
    const M = 65536;
    const hb = s1.map((w, i) => (s2[i] - w + M) % M);
    expect(s4).toEqual(s3.map((w, i) => (w - hb[i] + M) % M));
  });

  test('the query count claimed equals (N + 1)^d recomputed from the N and d on screen', async ({ page }) => {
    await openTab(page, /Cancel Them All/, '#panel-recursion');
    for (const size of ['4,2', '4,4', '6,4']) {
      await page.selectOption('#recursion-size', size);
      const [N, d] = size.split(',').map(Number);
      // BigInt, by a different route than the page's own exponentiation.
      let expected = 1n;
      for (let i = 0; i < d; i++) expected *= BigInt(N + 1);
      await expect(page.locator('#recursion-step')).toBeEnabled();
      const shown = expected.toLocaleString('en-US');
      await expectClaim(page, 'recursion-formula-queries', { text: shown, value: expected.toString() });
      await expectClaim(page, 'recursion-measured-queries', { text: shown, value: expected.toString() });
    }
  });

  test('the deployed query count is 1025^16 exactly, and its stated power of two agrees', async ({ page }) => {
    await openTab(page, /Cancel Them All/, '#panel-recursion');
    let expected = 1n;
    for (let i = 0; i < 16; i++) expected *= 1025n;
    expect(expected.toString()).toHaveLength(49);
    await expectClaim(page, 'recursion-deployed-queries', {
      contains: expected.toString(),
      value: expected.toString(),
    });
    const log2 = Number(await page.locator('[data-claim="recursion-deployed-log2"]').getAttribute('data-value'));
    // 2^log2 must land back on the same 49-digit number, to within rounding.
    expect(Math.abs(log2 - Math.log2(Number(expected)))).toBeLessThan(0.01);
    await expectClaim(page, 'recursion-deployed-log2', { text: `2^${log2.toFixed(2)}`, value: log2.toFixed(2) });
  });

  test('the colliding set sizes sum to the number of items the checker re-hashed', async ({ page }) => {
    // Parts-sum-to-whole, across two surfaces the page computes separately.
    await openTab(page, /Cancel Them All/, '#panel-recursion');
    await page.locator('#recursion-all').click();
    await page.locator('#recursion-check').click();
    const setSize = Number(await page.locator('[data-claim="verify-set-size"]').getAttribute('data-value'));
    const rehashed = Number(await page.locator('[data-claim="verify-rehashed"]').getAttribute('data-value'));
    expect(setSize).toBeGreaterThan(0);
    expect(rehashed).toBe(setSize);
    // The default instance is N = 4, so a complete comparison is four words.
    await expectClaim(page, 'verify-words-compared', { text: '4', value: '4' });
  });

  test('the two-bit run reports fewer queries than the one-bit formula, and the ratio agrees with both', async ({
    page,
  }) => {
    await openTab(page, /Two Bits At A Time/, '#panel-twobit');
    await page.locator('#twobit-run').click();
    const measured = Number(await page.locator('[data-claim="twobit-queries"]').getAttribute('data-value'));
    const oneBit = BigInt(
      (await page.locator('[data-claim="twobit-onebit-queries"]').getAttribute('data-value')) ?? '0',
    );
    expect(oneBit).toBe(7n ** 6n); // (N + 1)^d at the default size, recomputed here
    expect(BigInt(measured)).toBeLessThan(oneBit);
    // The ratio shown is the two numbers shown, divided — recomputed here.
    const ratio = (Number(oneBit) / measured).toFixed(1);
    await expectClaim(page, 'twobit-ratio', { text: `${ratio}×`, value: ratio });
  });

  test('the per-layer table rows equal the layer count the modulus demands', async ({ page }) => {
    await openTab(page, /Two Bits At A Time/, '#panel-twobit');
    await page.locator('#twobit-run').click();
    // d = 6 means three two-bit layers, and the table has one row per layer.
    // Scoped to that table: the panel also carries the quoted cost comparison.
    await expect(page.locator('#twobit-layers tbody tr')).toHaveCount(3);
    await page.selectOption('#twobit-size', '5,5');
    await page.locator('#twobit-run').click();
    // d = 5 means two two-bit layers plus a terminal one-bit step.
    await expect(page.locator('#twobit-layers tbody tr')).toHaveCount(2);
  });

  test('the deployed two-bit figures are the paper’s formulas evaluated, not quoted', async ({ page }) => {
    await openTab(page, /Two Bits At A Time/, '#panel-twobit');
    // ePrint 2026/2083 §6.1: p(1024, 550) ~ 0.98982, F(x) ~ 1069.70x + 511.57,
    // log2 E[Q] ~ 81.07, and Corollary 3's capped budget ~ 2^83.07.
    const p = Number(await page.locator('[data-claim="deployed-p"]').getAttribute('data-value'));
    expect(p).toBeGreaterThan(0.9897);
    expect(p).toBeLessThan(0.9900);
    const mu = Number(await page.locator('[data-claim="deployed-mu"]').getAttribute('data-value'));
    expect(Math.abs(mu - 1069.7)).toBeLessThan(0.5);
    const expected = Number(await page.locator('[data-claim="deployed-expected-log2"]').getAttribute('data-value'));
    const budget = Number(await page.locator('[data-claim="deployed-budget-log2"]').getAttribute('data-value'));
    expect(Math.abs(expected - 81.07)).toBeLessThan(0.1);
    // The capped budget is four times the expectation: two more bits, exactly.
    expect(Math.abs(budget - expected - 2)).toBeLessThan(0.01);
  });

  test('every failure path names its own cause', async ({ page }) => {
    await page.fill('#update-item', 'apples');
    await page.locator('#update-add').click();
    await expect(page.locator('#update-error')).toContainText('already in the set');
    await page.fill('#update-item', '  ');
    await page.locator('#update-add').click();
    await expect(page.locator('#update-error')).toContainText('empty string');

    await openTab(page, /The Real One/, '#panel-deployed');
    await page.locator('#deployed-paste').fill('not hex at all');
    await page.locator('#deployed-check').click();
    await expect(page.locator('[data-verdict="digest-parse"]')).toContainText('hex string');
    await page.locator('#deployed-paste').fill('00'.repeat(2048 - 1));
    await page.locator('#deployed-check').click();
    await expect(page.locator('[data-verdict="digest-parse"]')).toContainText('got 2047');

    await openTab(page, /Cancel Them All/, '#panel-recursion');
    await page.selectOption('#recursion-size', '8,8');
    await expect(page.locator('[data-verdict="recursion-size"]')).toContainText('exceeds this page');
  });

  test('changing the instance retires a verdict, and re-selecting the same one does not', async ({ page }) => {
    await openTab(page, /Two Bits At A Time/, '#panel-twobit');
    await page.locator('#twobit-run').click();
    await expect(page.locator('[data-verdict="twobit-collision"]')).toHaveAttribute('data-result', 'alarm');

    // Retirement: a result for one instance must not stand as a result for another.
    await page.selectOption('#twobit-size', '4,4');
    await expect(page.locator('[data-verdict="twobit-collision"]')).toHaveAttribute('data-result', 'pending');
    await expect(page.locator('[data-verdict="twobit-collision"]')).toContainText('Nothing run yet');

    // The no-op guard: re-selecting the SAME instance must not retire a fresh verdict.
    await page.locator('#twobit-run').click();
    await expect(page.locator('[data-verdict="twobit-collision"]')).toHaveAttribute('data-result', 'alarm');
    await page.selectOption('#twobit-size', '4,4');
    await expect(page.locator('[data-verdict="twobit-collision"]')).toHaveAttribute('data-result', 'alarm');
  });

  test('the recursion retires its collision verdict when the size changes', async ({ page }) => {
    await openTab(page, /Cancel Them All/, '#panel-recursion');
    await page.locator('#recursion-all').click();
    await page.locator('#recursion-check').click();
    await expect(page.locator('[data-verdict="collision-zero"]')).toHaveAttribute('data-result', 'alarm');
    await page.selectOption('#recursion-size', '6,4');
    await expect(page.locator('[data-verdict="collision-zero"]')).toHaveCount(0);
    await expect(page.locator('[data-verdict="collision-union"]')).toHaveCount(0);
  });

  test('a hidden panel is really hidden, not merely believed to be', async ({ page }) => {
    // The `[hidden]` cascade trap: a class rule that sets `display` outranks the
    // UA's `[hidden]` rule, so an element can paint while the code believes it is
    // hidden. Ask the browser what it actually paints.
    for (const id of ['deployed', 'onebit', 'recursion', 'twobit', 'limit']) {
      const visible = await page
        .locator(`#panel-${id}`)
        .evaluate((el) => (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true }));
      expect(visible, `#panel-${id} must not paint while hidden`).toBe(false);
    }
  });

  test('the negative claim is on screen in the state where every check passes', async ({ page }) => {
    // §4.1d. Three assertions: reach the fixture, everything is green, and the
    // limitation is visible in that state.
    await openTab(page, /Updates Correct/, '#panel-limit');

    // 2. Every verdict the page renders in this state reports success, except
    // the headline, whose whole point is that it reports both at once.
    const results = await page
      .locator('#panel-limit [data-verdict]:not([data-verdict="limit-headline"])')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-result')));
    expect(results.length).toBe(4);
    expect(results.every((r) => r === 'pass')).toBe(true);
    await expect(page.locator('[data-verdict="limit-headline"]')).toHaveAttribute('data-result', 'alarm');

    // 3. The limitation is visible here, not in the README and not behind a
    // disclosure the reader has to open.
    const claim = page.locator('[data-negative-claim="true"]');
    await expect(claim).toBeVisible();
    await expect(claim).toHaveText(
      'Correct incremental updating says nothing about collision resistance: for this reduced power-of-two instance, two different sets have the same digest.',
    );
    await expect(page.locator('#panel-limit')).toContainText('Reduced-size instance');
    await expect(page.locator('#panel-limit')).toContainText('There is no failure code for this.');

    // The sets really are different and really are disjoint.
    const s = Number(await page.locator('[data-claim="limit-size-s"]').getAttribute('data-value'));
    const t = Number(await page.locator('[data-claim="limit-size-t"]').getAttribute('data-value'));
    expect(s).toBeGreaterThan(0);
    expect(t).toBeGreaterThan(0);
    await expectClaim(page, 'limit-shared', { text: '0', value: '0' });
    await expectClaim(page, 'limit-words-equal', { text: '4 of 4', value: '4' });
  });
});
