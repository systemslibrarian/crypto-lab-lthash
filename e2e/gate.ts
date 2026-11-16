import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditControlNames, formatControlNameFailures } from './control-names';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old spec pushed
 *     `animation:none!important; transition:none!important` through
 *     `addStyleTag`. That BYPASSES this lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it,
 *     so the rendering a reduced-motion reader actually gets — a `.panel`
 *     arriving without its fade, a just-changed digest cell without its bump —
 *     was never once the rendering that got scanned. This gate sets the
 *     preference through `emulateMedia`, asserts from inside the page that it
 *     took effect (`test.use({ reducedMotion })` is a measured no-op on
 *     Playwright 1.61.x), and injects nothing.
 *
 *  2. IT FORCED EVERY PANEL VISIBLE FROM SCRIPT. Stripping `[hidden]` puts all
 *     six tabpanels on screen AT ONCE — a rendering no reader can reach — and
 *     script-opening the disclosures means the SHUT state, which is what every
 *     reader arrives at, was never scanned at all. This gate switches tabs by
 *     clicking them and opens each disclosure through its `<summary>`, which is
 *     the route a reader has, and scans before and after.
 *
 *  3. IT DROVE BLIND AND THEN THREW THE STATES AWAY. The old drive clicked every
 *     button whose label matched a regex, swallowed every failure with
 *     `.catch(() => {})`, waited a fixed 120ms per tab, and scanned ONCE at the
 *     end. Here the recursion's intermediate cancelled-bit states, the
 *     duplicate-item refusal, the over-cap refusal and the malformed-digest
 *     rejection would all have been overwritten before anything measured them.
 *     This drive names every control it touches, asserts a real completion
 *     signal after each, and scans after every step, at 1280px and at 380px.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The surfaces that carry
 *     this lab's meaning — every `.verdict-*` tone, both `.pill` states, the
 *     `.callout-danger` / `.callout-caveat` / `.learner-check` tints and the
 *     highlighted `.cell-in` / `.col-in` cells of a parity matrix — are all
 *     `color-mix()` fills axe files under `incomplete` rather than judging, as
 *     is the shared top bar's ink. So is an `aria-label` on a role-less element.
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR GENERATED-CONTENT ORACLE. This lab
 *     paints a great many small bordered things — word cells, parity-matrix
 *     cells, pills, and a custom select chevron drawn from two borders — and axe
 *     has no rule for any of their boundaries. `nontext.ts` measures them at
 *     every driven state, and `expectNoHorizontalOverflow` adds the 1.4.10 check
 *     axe has no rule for at all, which matters here because the deployed digest
 *     is a 4,096-character hex run and the parity matrices are real tables that
 *     have to stay inside their scroll regions.
 */
/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `style.css`'s reduced-motion
 * block cancels `.panel` / `.reveal` animations and every transition, so
 * `getAnimations()` is normally empty and this returns on the sixth frame. It
 * stays because the shared top bar's `.cl-btn` transitions are declared
 * OUTSIDE the lab's `@media` block — `* { transition: none !important }` wins
 * today, but that is a property of the current stylesheet, not of the page.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab
 * has EXACTLY that shape in miniature: `@keyframes fade` starts
 * `from { opacity: 0 }` and every tab panel rides it, while `@keyframes bump`
 * starts from a transform and every just-changed digest cell rides that. The
 * reduced-motion block cancels both with `animation: none`, which restores the
 * static `opacity: 1` and the untransformed position — correct today, and this
 * assertion is what makes that a measurement rather than a reading.
 *
 * `aria-hidden` subtrees are excluded; what this lab hides is decorative
 * verdict/pill glyphs beside their own words — see `contrast.ts`.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. Five of the six panels render synchronously at first activation,
 * so a renderer that throws leaves that tabpanel EMPTY — and an empty region is
 * exactly what a scan reports as perfectly accessible. The sixth, the deployed
 * instance, finishes one WebCrypto digest asynchronously, so a rejection there
 * leaves a verdict stuck at `pending` rather than throwing; the drive waits that
 * verdict out of `pending` for the same reason. Attach before `boot`, assert
 * after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * The shared `.cl-topbar` carries an explicit `role="banner"`. This lab's own
 * hero is a `<div class="cl-hero">`, not a `<header>`, so nothing here implies
 * a second banner today — the page's one `<footer>` is scoped inside `#app` —
 * but the shared bar's `dedupeBanner()` exists because other labs in this fleet
 * DID ship one, and the hero markup is the part of this page most likely to be
 * re-templated from a lab that uses `<header>`.
 * Asserting the OUTCOME rather than the markup is what catches that edit.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * List semantics survive their styling.
 *
 * Every digest, vector and item strip on this page is a `ul.words` styled
 * `list-style: none`, which is exactly the declaration that makes Safari and
 * VoiceOver DROP the list's implicit role. `dom.ts` compensates the documented
 * way — an explicit `role="list"` on the `<ul>` and `role="listitem"` on every
 * cell — so here, unlike most of this fleet, an explicit role on a list is the
 * fix rather than the defect. What is asserted is therefore the SHAPE of that
 * fix: any explicit role on a `ul`/`ol` must be `list` (any other value orphans
 * every `<li>` under it), and a `role="list"` must never sit on an empty
 * element, because axe applies `aria-required-children` to the explicit role and
 * fails it the day a strip renders with no cells — which a zero-word digest
 * would do. Roles are assigned inside an element-creation helper, so ask the DOM
 * rather than grepping the source.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els
      .filter((e) => e.getAttribute('role') !== 'list' || e.children.length === 0)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
      )
  );
  expect(
    broken,
    'an explicit non-list role on a list deletes its semantics; an empty role="list" fails aria-required-children'
  ).toEqual([]);
}

/**
 * Shared setup. Runs before EVERY test that imports it, so an assertion here
 * fails all of them at once, under whatever name those tests carry.
 *
 * SO THIS FUNCTION ASSERTS STRUCTURE AND NEVER PRODUCT COPY. On 2026-09-26
 * crypto-lab-mceliece-gate changed one textarea's default string; its gate.ts
 * still asserted the old sentence, boot() threw, both axe runs failed, the
 * build job failed, the deploy was skipped, and deploy-sync reported the lab
 * stale. The step that went red was called "Accessibility gate", and four of
 * its six a11y tests had passed. For three days the live site served security
 * claims that main had already corrected, and the one red thing in sight named
 * the wrong subject.
 *
 * Structure: the control exists, the arrival panel is the one that ships,
 * counts, [hidden]/toBeEmpty on lazily-rendered panels, a default matching a
 * SHAPE. What a verdict SAYS belongs in e2e/claims.spec.ts and
 * e2e/verdicts.spec.ts, where a failure names the claim as its subject.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.x, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. Nothing in this lab's JS branches on
 * `matchMedia`, but the CSS reduced-motion block is the only thing standing
 * between a scan and the mid-flight `fade` opacity and `bump` transform, so the
 * assertion is the difference between scanning the reduced-motion rendering and
 * merely believing we did.
 *
 * Dark is the only theme and the page pins it with a literal before first
 * paint, so there is nothing to seed: the assertion below reads what the page
 * stamped on `<html>` rather than what a test asked for.
 *
 * The defaults are asserted at length because `main.ts` renders each tabpanel
 * lazily on first activation. A navigation that resolves proves nothing: a
 * renderer that threw would leave its panel EMPTY, and an empty region is
 * exactly what a scan reports as perfectly accessible.
 */
export async function boot(page: Page, theme: 'dark' = 'dark'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect',
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // The page really rendered.
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('.tab-btn')).toHaveCount(6);

  // The shared skip link points at an id that exists. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run
  // says nothing about.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('#app')).toHaveCount(1);

  // Dark is the only theme, so the page must carry no theme control at all —
  // not the shared bar's, which was removed, and not a lab-local one. The
  // shared CSS hides any lab toggle with `display:none !important`, which would
  // leave a dead-but-known element; asserting the count at zero catches the day
  // one is added without going through that list.
  await expect(
    page.locator('#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]'),
  ).toHaveCount(0);

  // The arrival state: the first exhibit rendered, the other five not.
  // `renderUpdatePanel` builds a three-item set and runs every comparison at
  // mount, so first paint carries real verdicts rather than placeholders. The
  // other five panels are lazily rendered: hidden AND EMPTY until their tab is
  // first activated — asserted, because "empty" is this lab's tell that a
  // renderer threw (see `watchPageErrors`).
  await expect(page.locator('#panel-update')).toBeVisible();
  await expect(page.locator('#panel-update [data-verdict]')).toHaveCount(3);
  for (const id of ['deployed', 'onebit', 'recursion', 'twobit', 'limit']) {
    await expect(page.locator(`#panel-${id}`)).toBeHidden();
    await expect(page.locator(`#panel-${id}`)).toBeEmpty();
  }

  // Every shipped control default, as a SHAPE. The item box holds a word;
  // WHICH word is a claim and belongs in claims.spec.ts. Asserting the string
  // here would make every a11y test depend on one line of copy.
  await expect(page.locator('#update-item')).toHaveValue(/^[a-z][a-z-]*$/);
  await expect(page.locator('#update-n')).toHaveValue(/^[0-9]+$/);
  await expect(page.locator('#update-d')).toHaveValue(/^[0-9]+$/);
  await expect(page.locator('input[name="update-mode"][value="set"]')).toBeChecked();
  // Every verdict on the arrival panel paints a state rather than nothing, and
  // every measurement carries its machine value beside it. WHICH state, and
  // what it says, are claims.
  for (const marker of await page.locator('#panel-update [data-verdict]').all()) {
    await expect(marker).toHaveAttribute('data-result', /^(pass|fail|alarm|pending)$/);
  }
  for (const marker of await page.locator('#panel-update [data-claim]').all()) {
    await expect(marker).toHaveAttribute('data-value', /.+/);
  }

  // Disclosures ship shut.
  await expect(page.locator('#panel-update details[open]')).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}
/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab has
 * both shapes that break it. Its long values run to 4,096 hex characters for the
 * deployed digest: every `.field-value` relies on `overflow-wrap: anywhere`
 * instead of a scroll region, and the full digest sits in a `<textarea>` that
 * must not widen its column. Its parity matrices and statistics tables are real
 * tables, which do NOT wrap — each is wrapped in a `.table-wrap` scroll region
 * so the table scrolls instead of the document. At 380px, with six exhibits and
 * tables up to nine columns wide, this check is what proves that wrapper is
 * doing its job.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab has real scrollers rather than hypothetical ones: every table it
 * paints — the reference sequence, both parity matrices, the level log, the
 * per-layer statistics and the quoted cost comparison — sits in a `.table-wrap`
 * with `overflow-x: auto`. `dom.ts`'s `tableRegion` gives each one
 * `tabindex="0"`, `role="region"` and an `aria-label`, which is the keyboard
 * route axe cannot see the absence of. This assertion keeps that a property of
 * the page rather than a habit of whoever adds the next table.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden`
 * DO remove an element from the tab order, so those are skipped rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair. The
 * `hidden` tabpanels here take the `display: none` route, which is why five
 * panels' worth of buttons are legitimately absent from the tab order.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: the shared skip link parks at `top:-3rem` with
 * full opacity and slides in on focus. The drive scans it focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run
 * with it set prints every finding as it happens and then fails at the end, so
 * a green collection run cannot be mistaken for a green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no
 * text node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide
 * this oracle had been called from inside a soft wrapper AFTER its
 * `if (!COLLECTING) return` guard — so in a strict run, which is every run in
 * CI and every run anyone reads as a pass, the guard returned first and
 * `nontext.ts` never executed at all. Thirteen repos certified themselves
 * clean on an oracle that had never looked. Calling it here means it runs at
 * every driven state, including `:hover`, and this repo's baseline was
 * captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the
 * point — or the drive stopped reaching the state that shows it, which is a
 * coverage regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Nine assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those ratios
 *    arithmetically — which matters here because the surfaces carrying this
 *    lab's meaning are `color-mix()` fills axe cannot resolve: every verdict
 *    tone, both pill states, the danger/caveat/scope callouts, the learner-check
 *    tint, the hero aside, the highlighted parity-matrix cells and the shared
 *    bar's ink. Everything else in that bucket is a real result axe simply could
 *    not finish — including `aria-prohibited-attr`, which is where an
 *    `aria-label` on a role-less element hides. This page leans on getting that
 *    right: the domain radio group and every learner-check option row pair their
 *    labels with `role="group"`, and each `.table-wrap` carries `role="region"`
 *    with a label. Drop any of those roles and the label is silently discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - the same walk over `aria-hidden` content with the exemption lifted —
 *    SC 1.4.3 is about what a reader SEES; see `contrast.ts` for what this
 *    lab hides and why it is measured anyway.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of
  // axe-core 4.12's 105 rule definitions; the chained form executes 4.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: a sticky `<header role="banner">` above a
  // `<div id="app">` holding an `<aside class="cl-hero-why">`, two `<nav>`s
  // (the shared actions and the tablist wrapper), one `<main>`, several
  // `role="region"` table wrappers and a footer.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast`
  // is allowed to remain, and only because the arithmetic walk below judges
  // those ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  // axe's `label` rule accepts a bare `placeholder` as an accessible name, so a
  // deleted label can leave this gate green. See `control-names.ts`.
  const unnamed = formatControlNameFailures(await auditControlNames(page));
  softExpect(unnamed, `form controls named only by placeholder/title in state: ${label}`, []);

  // The aria-hidden walk, exemption lifted — axe skips this text entirely and
  // the default walk honours the same boundary, so this second call is the
  // ONLY thing that ever measures it. See `contrast.ts` for the inventory.
  const hiddenContrast = Array.from(
    new Set(
      formatContrastFailures(
        await auditContrast(page, '[aria-hidden="true"], [aria-hidden="true"] *', true)
      )
    )
  );
  softExpect(hiddenContrast, `measured aria-hidden contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}

// ---------------------------------------------------------------------------
// The drive
// ---------------------------------------------------------------------------

/** Switch to a tab by clicking it, and prove the switch happened. */
async function openTab(page: Page, name: RegExp, panelId: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(panelId)).toBeVisible();
  await expect(page.locator(panelId)).not.toBeEmpty();
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Five things shape this drive:
 *
 *  - THE ARRIVAL STATE IS SCANNED FIRST, exactly as a reader gets it: the first
 *    exhibit rendered with its three comparisons already computed, five panels
 *    hidden and unrendered, every disclosure shut.
 *
 *  - EVERY PANEL IS RENDERED LAZILY, so a tab that is never clicked is a panel
 *    that is never even IN the DOM. Each of the six is activated through its
 *    real tab button and scanned in its own driven states.
 *
 *  - EVERY REFUSAL AND ALARM STATE. A duplicate item in set mode, an attack size
 *    over the cap, a digest of the wrong length, and the three alarm verdicts
 *    where a collision is found — none of these is reachable without doing
 *    something deliberate, and an alarm tone that no scan ever measured is
 *    exactly the tone this lab most needs measured.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves, so it is the state
 *    a reader occupies the instant after pressing a button — and `.tab-btn:hover`
 *    and `.cl-btn:hover` both repaint their fill. It is scanned explicitly.
 *
 *  - NO FIXED TIMEOUTS. Every wait is on a real DOM completion signal: a verdict
 *    leaving `pending`, a button becoming disabled, a status line's wording, a
 *    row count, `aria-selected`.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);

  await scanAt('arrival: the update exhibit computed, five panels unrendered, disclosures shut');

  // The shared skip link, focused.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the shared skip link focused, slid in from top:-3rem');

  // ── 1. A hash you can update ───────────────────────────────────────────
  await page.fill('#update-item', 'figs');
  await page.locator('#update-add').click();
  await expect(page.locator('#update-last')).toContainText('figs');
  await scanAt('update: an item added, its vector and the changed digest words on screen');

  await page.locator('#update-remove').click();
  await expect(page.locator('#update-last')).toBeVisible();
  await scanAt('update: the same item removed again');

  // The duplicate refusal: set mode cannot hold an item twice.
  await page.fill('#update-item', 'apples');
  await page.locator('#update-add').click();
  await expect(page.locator('#update-error')).toBeVisible();
  await scanAt('update: a duplicate refused in set mode — the danger callout');

  // The empty-item refusal.
  await page.fill('#update-item', '   ');
  await page.locator('#update-add').click();
  await expect(page.locator('#update-error')).toBeVisible();
  await scanAt('update: an empty item refused');

  // Multiset mode accepts what set mode refused, and a never-added removal
  // paints the caveat callout.
  await page.locator('input[name="update-mode"][value="multiset"]').check();
  await expect(page.locator('input[name="update-mode"][value="multiset"]')).toBeChecked();
  await page.fill('#update-item', 'apples');
  await page.locator('#update-add').click();
  await page.fill('#update-item', 'never-added');
  await page.locator('#update-remove').click();
  await expect(page.locator('#panel-update .callout-caveat')).toBeVisible();
  await scanAt('update: multiset mode, and an item removed that was never added');

  // A one-bit modulus is a real instance and renders a one-column digest.
  await page.selectOption('#update-d', '1');
  await expect(page.locator('#panel-update')).toContainText('2^1');
  await scanAt('update: d = 1, the smallest modulus this page offers');

  await page.selectOption('#update-d', '16');
  await page.selectOption('#update-n', '16');
  await expect(page.locator('#panel-update .word')).not.toHaveCount(0);
  await scanAt('update: the widest reduced instance, 16 words of 16 bits');

  await page.locator('#panel-update details.disclosure > summary').click();
  await expect(page.locator('#panel-update details.disclosure[open]')).toHaveCount(1);
  await scanAt('update: the "where the numbers come from" disclosure open');

  await page.locator('#panel-update details.learner-check > summary').click();
  await page.locator('#panel-update .check-opt', { hasText: 'No, order changes the digest' }).click();
  await expect(page.locator('#panel-update .pill-bad')).toBeVisible();
  await scanAt('update: quick check answered wrong — the Not quite pill');

  await page.locator('#panel-update .check-opt', { hasText: 'Yes, they agree' }).click();
  await expect(page.locator('#panel-update .pill-ok')).toBeVisible();
  await scanAt('update: quick check answered right — the Correct pill');

  // ── 2. The real one ────────────────────────────────────────────────────
  await openTab(page, /The Real One/, '#panel-deployed');
  // The WebCrypto digest resolves asynchronously; wait it out of `pending`
  // rather than scanning a half-rendered card.
  await expect(page.locator('[data-verdict="folly-sha256"]')).not.toHaveAttribute('data-result', 'pending');
  await scanAt('deployed: the reference checksum reproduced and agreed with by WebCrypto');

  await page.locator('#deployed-check').click();
  await expect(page.locator('[data-verdict="digest-parse"]')).toBeVisible();
  await scanAt('deployed: a digest of the wrong length refused, naming the cause');

  await page.locator('#deployed-reroll').click();
  await expect(page.locator('[data-verdict="deployed-incremental"]')).toBeVisible();
  await scanAt('deployed: a fresh random sequence checked against a full recomputation');

  await page.locator('#panel-deployed details.disclosure > summary').click();
  await expect(page.locator('#panel-deployed details.disclosure[open]')).toHaveCount(1);
  await scanAt('deployed: the BLAKE2Xb parameterisation disclosure open');

  // ── 3. Cancel one bit ──────────────────────────────────────────────────
  await openTab(page, /Cancel One Bit/, '#panel-onebit');
  await scanAt('one bit: the matrix as hashed, before any elimination');

  await page.locator('#onebit-next').click();
  await expect(page.locator('#onebit-step-status')).toContainText('Step 1');
  await scanAt('one bit: one elimination step applied');

  await page.locator('#onebit-run').click();
  await expect(page.locator('#onebit-next')).toBeDisabled();
  await expect(page.locator('#panel-onebit .cell-in').first()).toBeVisible();
  await scanAt('one bit: elimination finished, the subset columns highlighted');

  await page.selectOption('#onebit-n', '8');
  await expect(page.locator('#onebit-step-status')).toContainText('Step 0');
  await scanAt('one bit: the widest matrix this exhibit offers, nine columns');

  await page.locator('#onebit-reset').click();
  await page.locator('#panel-onebit details.learner-check > summary').click();
  await page.locator('#panel-onebit .check-opt', { hasText: 'Yes, elimination works over any field' }).click();
  await expect(page.locator('#panel-onebit .pill-bad')).toBeVisible();
  await scanAt('one bit: quick check answered wrong');

  // ── 4. Cancel them all ─────────────────────────────────────────────────
  await openTab(page, /Cancel Them All/, '#panel-recursion');
  await expect(page.locator('#recursion-step')).toBeEnabled();
  await scanAt('recursion: base items hashed, no bit cancelled yet');

  await page.locator('#recursion-step').click();
  await expect(page.locator('#panel-recursion tbody tr')).toHaveCount(1);
  await scanAt('recursion: one bit cancelled, the level log open');

  await page.locator('#recursion-all').click();
  await expect(page.locator('#recursion-step')).toBeDisabled();
  await expect(page.locator('#recursion-check')).toBeVisible();
  await scanAt('recursion: every bit cancelled, the modulus down to 1');

  await page.locator('#recursion-check').click();
  await expect(page.locator('[data-verdict="collision-zero"]')).toHaveAttribute('data-result', 'alarm');
  await expect(page.locator('[data-verdict="collision-union"]')).toHaveAttribute('data-result', 'alarm');
  await scanAt('recursion: the independent checker reporting a collision — two alarm verdicts');

  // The over-cap refusal, which is the only way this page says no to a size.
  await page.selectOption('#recursion-size', '8,8');
  await expect(page.locator('[data-verdict="recursion-size"]')).toHaveAttribute('data-result', 'fail');
  await scanAt('recursion: a size over the cap refused, naming the count and the cap');

  await page.selectOption('#recursion-size', '4,2');
  await expect(page.locator('#recursion-step')).toBeEnabled();
  await scanAt('recursion: the smallest instance, back from the refusal');

  await page.locator('#panel-recursion details.learner-check > summary').click();
  await page.locator('#panel-recursion .check-opt', { hasText: 'Doubling N' }).click();
  await expect(page.locator('#panel-recursion .pill-bad')).toBeVisible();
  await scanAt('recursion: quick check answered wrong');

  // ── 5. Two bits at a time ──────────────────────────────────────────────
  await openTab(page, /Two Bits At A Time/, '#panel-twobit');
  await expect(page.locator('[data-verdict="twobit-collision"]')).toHaveAttribute('data-result', 'pending');
  await scanAt('two bits: nothing run yet — the pending verdict');

  await page.locator('#twobit-run').click();
  await expect(page.locator('[data-verdict="twobit-collision"]')).toHaveAttribute('data-result', 'alarm');
  await scanAt('two bits: a run finished, two sets colliding, the per-layer table filled');

  await page.selectOption('#twobit-size', '5,5');
  await page.locator('#twobit-run').click();
  await expect(page.locator('[data-verdict="twobit-collision"]')).toHaveAttribute('data-result', 'alarm');
  await scanAt('two bits: an odd modulus, where a one-bit layer finishes the job');

  await page.locator('#panel-twobit details.disclosure > summary').click();
  await expect(page.locator('#panel-twobit details.disclosure[open]')).toHaveCount(1);
  await scanAt('two bits: the per-layer walkthrough disclosure open');

  // ── 6. Updates correct, sets different ─────────────────────────────────
  await openTab(page, /Updates Correct/, '#panel-limit');
  await expect(page.locator('[data-verdict="limit-headline"]')).toHaveAttribute('data-result', 'alarm');
  await scanAt('the limit: every check green and the two sets colliding anyway');

  await page.locator('#limit-rebuild').click();
  await expect(page.locator('[data-verdict="limit-headline"]')).toHaveAttribute('data-result', 'alarm');
  await scanAt('the limit: rebuilt with fresh items');

  await page.locator('#panel-limit details.learner-check > summary').click();
  await page.locator('#panel-limit .check-opt', { hasText: 'Correct incremental updating' }).click();
  await expect(page.locator('#panel-limit .pill-bad')).toBeVisible();
  await scanAt('the limit: quick check answered wrong');

  // ── Hover, which persists after a click ────────────────────────────────
  await page.locator('#limit-rebuild').hover();
  await scanAt('a secondary button hovered');

  await page.getByRole('tab', { name: /Cancel One Bit/ }).hover();
  await scanAt('an inactive tab hovered — its surface-2 fill repainted');

  await page.locator('.cl-topbar .cl-btn').first().hover();
  await scanAt('a shared top bar control hovered');

  // ── Focus rings on the controls that take them ─────────────────────────
  await page.locator('#panel-limit .table-wrap').first().focus().catch(() => undefined);
  await page.getByRole('tab', { name: /Updates Correct/ }).focus();
  await scanAt('the active tab focused');
}
