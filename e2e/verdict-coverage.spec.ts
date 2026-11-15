import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Coverage is derived from the rendered page, never from an enumeration written
 * by hand. A list of "the verdicts this lab has" is a self-report; the DOM is
 * evidence.
 *
 * Three rules, checked against every state this spec drives:
 *
 *  1. NOTHING RENDERS VERDICT WORDS OR VERDICT STYLING OUTSIDE A MARKER. This is
 *     what catches a careless banner dropped in later — a sentence that reads as
 *     an outcome but that no test asserts and no mutation can kill.
 *  2. EVERY NUMBER IN A STATISTICS GRID IS A MARKED CLAIM. The scope is `.stats`
 *     rather than the whole document on purpose: this page states measurements
 *     in prose all the time ("2,048 bytes", "32 output blocks"), and a rule that
 *     flagged those would be switched off within a week. Inside a stats grid the
 *     number IS the reported result, so it has to carry its machine value.
 *  3. THE MUTATION REGISTRY HAS NOT ROTTED. Every `find` string in
 *     e2e/verdict-mutations.json must still occur exactly once in its file — a
 *     mutation whose anchor no longer matches guards nothing, and its failure
 *     mode is silence — and every marker a record names must really be rendered
 *     by the page.
 *
 * What this file deliberately does NOT claim is that every rendered marker has a
 * mutation behind it. Eight mutations are recorded, each a concrete patch with
 * an enforced kill; the rest of the markers are held by e2e/verdicts.spec.ts and
 * e2e/claims.spec.ts. Saying otherwise would be claiming coverage this lab does
 * not have.
 */

/** Shouty outcome words, matched only in ALL CAPS and only as whole words. */
const VERDICT_WORDS = [
  'ACCEPTED', 'ALARM', 'BROKEN', 'COLLIDES', 'CONFIRMED', 'DIFFERENT', 'DIFFERS', 'EQUAL',
  'FAIL', 'FAILED', 'IDENTICAL', 'INVALID', 'MATCH', 'MATCHES', 'MISMATCH', 'PASS', 'PASSED',
  'PROVEN', 'REFUSED', 'REJECTED', 'SAFE', 'SECURE', 'SUCCESS', 'UNSAFE', 'VALID', 'VERDICT',
  'VERIFIED', 'ZERO',
];

const STYLE_SELECTOR = '[class*="verdict"], [data-result]';

interface Violation {
  state: string;
  kind: 'word' | 'styling' | 'measurement';
  detail: string;
  where: string;
}

async function scanState(page: Page, state: string): Promise<Violation[]> {
  return page.evaluate(
    ([label, words, styleSelector]) => {
      const describe = (el: Element): string => {
        const id = el.id ? `#${el.id}` : '';
        const cls = typeof el.className === 'string' && el.className.trim()
          ? `.${el.className.trim().split(/\s+/).join('.')}`
          : '';
        return `${el.tagName.toLowerCase()}${id}${cls}`;
      };
      const visible = (el: Element): boolean => el.getClientRects().length > 0;
      const out: Violation[] = [];

      for (const el of document.querySelectorAll(styleSelector)) {
        if (el.closest('[data-verdict]')) continue;
        if (!visible(el)) continue;
        out.push({ state: label, kind: 'styling', detail: describe(el), where: describe(el.parentElement ?? el) });
      }

      const pattern = new RegExp(`(?<![A-Z])(${words.join('|')})(?![A-Z])`, 'g');
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const owner = node.parentElement;
        if (!owner || owner.closest('[data-verdict]') || !visible(owner)) continue;
        const text = node.textContent ?? '';
        for (const hit of new Set([...text.matchAll(pattern)].map((m) => m[1]))) {
          out.push({ state: label, kind: 'word', detail: hit, where: `${describe(owner)} :: ${text.trim().slice(0, 80)}` });
        }
      }

      // A number inside a statistics grid is the reported result, so it must
      // carry its machine value.
      for (const dd of document.querySelectorAll('.stats dd')) {
        if (!visible(dd)) continue;
        if (dd.querySelector('[data-claim]') || dd.closest('[data-claim]')) continue;
        const text = (dd.textContent ?? '').trim();
        if (!/\d/.test(text)) continue;
        out.push({ state: label, kind: 'measurement', detail: text.slice(0, 60), where: describe(dd) });
      }
      return out;
    },
    [state, VERDICT_WORDS, STYLE_SELECTOR] as const,
  );
}

test('no verdict words, verdict styling or unmarked statistics outside a marker', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('./');
  await expect(page.locator('#app')).not.toBeEmpty();
  const found: Violation[] = [];
  found.push(...(await scanState(page, 'arrival')));

  const drive: [RegExp, string, (p: Page) => Promise<void>][] = [
    [/The Real One/, '#panel-deployed', async (p) => {
      await expect(p.locator('[data-verdict="folly-sha256"]')).not.toHaveAttribute('data-result', 'pending');
      await p.locator('#deployed-check').click();
    }],
    [/Cancel One Bit/, '#panel-onebit', async (p) => {
      await p.locator('#onebit-run').click();
    }],
    [/Cancel Them All/, '#panel-recursion', async (p) => {
      await p.locator('#recursion-all').click();
      await p.locator('#recursion-check').click();
    }],
    [/Two Bits At A Time/, '#panel-twobit', async (p) => {
      await p.locator('#twobit-run').click();
    }],
    [/Updates Correct/, '#panel-limit', async () => undefined],
  ];

  for (const [name, panel, act] of drive) {
    await page.getByRole('tab', { name }).click();
    await expect(page.locator(panel)).not.toBeEmpty();
    found.push(...(await scanState(page, `${panel} on arrival`)));
    await act(page);
    found.push(...(await scanState(page, `${panel} driven`)));
  }

  expect(found, JSON.stringify(found, null, 2)).toEqual([]);
});

test('every recorded mutation still anchors, and every marker it names is rendered', async ({ page }) => {
  test.setTimeout(300_000);
  const registry = JSON.parse(readFileSync(new URL('./verdict-mutations.json', import.meta.url), 'utf8')) as {
    mutations: Record<string, { file: string; find: string; replace: string; kills?: Record<string, unknown> }>;
  };
  const entries = Object.entries(registry.mutations);
  expect(entries.length, 'the registry must record the mutations this lab claims').toBeGreaterThan(0);

  const rotted: string[] = [];
  for (const [id, entry] of entries) {
    const source = readFileSync(new URL(`../${entry.file}`, import.meta.url), 'utf8');
    const occurrences = source.split(entry.find).length - 1;
    if (occurrences !== 1) rotted.push(`${id}: find occurs ${occurrences}x in ${entry.file}, expected exactly 1`);
    if (source.includes(entry.replace)) rotted.push(`${id}: the mutated text is ALREADY in ${entry.file}`);
  }
  expect(rotted, rotted.join('\n')).toEqual([]);

  // Every marker a record names must really be rendered by the page.
  const named = new Set(entries.flatMap(([, e]) => Object.keys(e.kills ?? {})));
  await page.goto('./');
  const rendered = new Set<string>();
  const collect = async (): Promise<void> => {
    for (const id of await page.locator('[data-verdict]').evaluateAll((els) => els.map((e) => e.getAttribute('data-verdict') ?? ''))) {
      rendered.add(id);
    }
    for (const id of await page.locator('[data-claim]').evaluateAll((els) => els.map((e) => e.getAttribute('data-claim') ?? ''))) {
      rendered.add(id);
    }
  };
  await collect();
  for (const [name, panel, act] of [
    [/The Real One/, '#panel-deployed', async (p: Page) => { await p.locator('#deployed-check').click(); }],
    [/Cancel One Bit/, '#panel-onebit', async (p: Page) => { await p.locator('#onebit-run').click(); }],
    [/Cancel Them All/, '#panel-recursion', async (p: Page) => { await p.locator('#recursion-all').click(); await p.locator('#recursion-check').click(); }],
    [/Two Bits At A Time/, '#panel-twobit', async (p: Page) => { await p.locator('#twobit-run').click(); }],
    [/Updates Correct/, '#panel-limit', async () => undefined],
  ] as [RegExp, string, (p: Page) => Promise<void>][]) {
    await page.getByRole('tab', { name }).click();
    await expect(page.locator(panel)).not.toBeEmpty();
    await act(page);
    await collect();
  }
  const missing = [...named].filter((id) => !rendered.has(id));
  expect(missing, `markers named by a mutation record that the page never renders: ${missing.join(', ')}`).toEqual([]);
});
