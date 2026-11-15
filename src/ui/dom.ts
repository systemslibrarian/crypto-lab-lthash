/** Tiny, dependency-free DOM helpers shared by the panels. */

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined;

/** Hyperscript: h('button', { class: 'x', onclick: fn }, 'label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export type VerdictState = 'pass' | 'fail' | 'alarm' | 'pending';

/**
 * A rendered outcome: icon + text + colour, never colour alone, and carrying
 * `data-verdict` / `data-result` so e2e/verdicts.spec.ts can assert the words
 * and the painted state together and the mutation ledger can name what kills it.
 *
 * Colour tracks SYSTEM INTEGRITY, not the return value: a collision that the
 * construction accepts is an `alarm`, never a green success.
 */
export function verdict(id: string, state: VerdictState, text: string, ...extra: Child[]): HTMLElement {
  const icon = state === 'pass' ? '✓' : state === 'alarm' ? '⚠' : state === 'fail' ? '✕' : '·';
  return h(
    'div',
    { class: `verdict verdict-${state}`, role: 'status', 'aria-live': 'polite', 'data-verdict': id, 'data-result': state },
    h('span', { class: 'verdict-icon', 'aria-hidden': 'true' }, icon),
    h('span', {}, text),
    ...extra,
  );
}

/**
 * A rendered measurement. The text a reader sees and the machine value behind it
 * are one claim, so a mutation has to move both; `data-claim` is what
 * e2e/verdict-coverage.spec.ts counts and what claims.spec.ts re-derives.
 */
export function claimValue(id: string, text: string, value: string | number): HTMLElement {
  return h('span', { 'data-claim': id, 'data-value': String(value) }, text);
}

/** A labelled statistic whose value carries its own claim marker. */
export function stat(id: string, label: string, text: string, value: string | number, big = false): HTMLElement {
  return h(
    'div',
    { class: big ? 'stat stat-big' : 'stat' },
    h('dt', {}, label),
    h('dd', {}, claimValue(id, text, value)),
  );
}

export function statList(...stats: HTMLElement[]): HTMLElement {
  return h('dl', { class: 'stats' }, ...stats);
}

/** A labelled read-only value shown as wrapping monospace (no scroll region needed). */
export function field(label: string, value: string, opts: { mono?: boolean; sub?: string } = {}): HTMLElement {
  return h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label' }, label, opts.sub ? h('span', { class: 'field-sub' }, ` ${opts.sub}`) : null),
    h('code', { class: opts.mono === false ? 'field-value plain' : 'field-value' }, value),
  );
}

/** Section heading + intro paragraph(s) for a panel. */
export function panelIntro(title: string, lede: string, ...paras: (string | HTMLElement)[]): HTMLElement {
  return h(
    'div',
    { class: 'panel-intro' },
    h('h2', {}, title),
    h('p', { class: 'lede' }, lede),
    ...paras.map((p) => (typeof p === 'string' ? h('p', {}, p) : p)),
  );
}

/** A scoping / "what this isn't" note. */
export function note(kind: 'info' | 'danger' | 'caveat' | 'scope', ...children: Child[]): HTMLElement {
  return h('p', { class: `callout callout-${kind}` }, ...children);
}

/** The label every reduced-size result must carry (invariant 2). */
export function reducedLabel(N: number, d: number): HTMLElement {
  return h(
    'p',
    { class: 'callout callout-scope', 'data-reduced-label': 'true' },
    `Reduced-size instance: N = ${N} words of d = ${d} bits, arithmetic modulo 2^${d}. `,
    'The deployed instance is N = 1024, d = 16. Nothing on this panel is a result about it.',
  );
}

/** Replace evidence that no longer belongs to the controls currently on screen. */
export function evidenceRetired(text: string): HTMLElement {
  return h('p', { class: 'callout evidence-retired', role: 'status', 'aria-live': 'polite' }, text);
}

/** A select with a visible label and a custom chevron (appearance: none). */
export function select(
  id: string,
  label: string,
  options: readonly { value: string; text: string }[],
  value: string,
  onchange: (value: string) => void,
): HTMLElement {
  const el = h(
    'select',
    { id, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
    ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.text)),
  );
  return h('div', { class: 'control' }, h('label', { for: id }, label), h('div', { class: 'select-wrap' }, el));
}

export function button(label: string, onclick: () => void, opts: { kind?: 'primary' | 'ghost' | 'danger'; id?: string } = {}): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: `btn btn-${opts.kind ?? 'ghost'}`, id: opts.id, onclick },
    label,
  ) as HTMLButtonElement;
}

/** Middle-truncate a long hex string for compact display. */
export function short(hex: string, keep = 12): string {
  if (hex.length <= keep * 2 + 1) return hex;
  return `${hex.slice(0, keep)}…${hex.slice(-keep)}`;
}

/**
 * The digest as word cells: index above value, so word-wise addition is visible
 * rather than asserted. `changed` marks the cells an action just moved; the
 * highlight animation is tied to that action and cancelled under reduced motion.
 */
export function wordCells(
  words: Uint32Array,
  opts: { changed?: Set<number>; limit?: number; label: string; plus?: boolean } = { label: 'digest words' },
): HTMLElement {
  const limit = opts.limit ?? words.length;
  const shown = Math.min(limit, words.length);
  const cells: HTMLElement[] = [];
  for (let i = 0; i < shown; i++) {
    const classes = ['word'];
    if (words[i] === 0) classes.push('word-zero');
    if (opts.changed?.has(i)) classes.push('word-changed');
    if (words[i] > 9999) classes.push('word-wide');
    cells.push(
      h(
        'li',
        { class: classes.join(' '), role: 'listitem' },
        h('span', { class: 'word-idx' }, String(i)),
        h('span', { class: 'word-val' }, String(words[i])),
      ),
    );
  }
  const ul = h('ul', { class: opts.plus ? 'words words-add' : 'words', role: 'list', 'aria-label': opts.label }, ...cells);
  if (shown < words.length) {
    return h(
      'div',
      {},
      ul,
      h('p', { class: 'help' }, `First ${shown} of ${words.length} words shown; the full digest is in the field below.`),
    );
  }
  return ul;
}

/** A table in a keyboard-reachable scroll region (WCAG 2.1.1 + 1.4.10). */
export function tableRegion(label: string, table: HTMLElement): HTMLElement {
  return h('div', { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-label': label }, table);
}

export function progress(label: string): { el: HTMLElement; set: (done: number, total: number, text?: string) => void } {
  const text = h('p', { class: 'progress-label' }, `${label}: 0`);
  const fill = h('div', { class: 'progress-fill' });
  const el = h(
    'div',
    { class: 'progress', role: 'status', 'aria-live': 'polite' },
    text,
    h('div', { class: 'progress-track' }, fill),
  );
  return {
    el,
    set: (done, total, override) => {
      text.textContent = override ?? `${label}: ${done.toLocaleString('en-US')} / ${total.toLocaleString('en-US')}`;
      fill.style.width = `${total === 0 ? 0 : Math.round((done / total) * 100)}%`;
    },
  };
}

/** A disclosure: shut on arrival, opened through its own summary. */
export function disclosure(summary: string, ...children: Child[]): HTMLElement {
  return h('details', { class: 'disclosure' }, h('summary', {}, summary), h('div', { class: 'disclosure-body' }, ...children));
}

/**
 * A "predict before you reveal" check: one misconception, a couple of choices,
 * and an immediate explanation. No score and no gamification; the lab stays
 * fully usable whether or not it is answered.
 */
export function learnerCheck(
  question: string,
  options: { label: string; correct: boolean }[],
  explanation: string,
): HTMLElement {
  const feedback = h('div', { class: 'check-feedback', role: 'status', 'aria-live': 'polite' });
  const buttons = options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-ghost check-opt',
        onclick: () => {
          clear(feedback);
          feedback.append(
            h(
              'span',
              { class: `pill pill-${o.correct ? 'ok' : 'bad'}` },
              h('span', { 'aria-hidden': 'true' }, o.correct ? '✓ ' : '✕ '),
              o.correct ? 'Correct' : 'Not quite',
            ),
            h('p', { class: 'check-explain' }, explanation),
          );
        },
      },
      o.label,
    ),
  );
  return h(
    'details',
    { class: 'learner-check' },
    h('summary', {}, 'Quick check'),
    h(
      'div',
      { class: 'check-body' },
      h('p', { class: 'check-q' }, question),
      h('div', { class: 'input-row', role: 'group', 'aria-label': question }, ...buttons),
      feedback,
    ),
  );
}

/** Yield to the event loop so a long chunked computation keeps the page alive. */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
