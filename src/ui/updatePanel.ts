/**
 * Exhibit 1 — A hash you can update.
 *
 * The headline mechanism, shown rather than asserted: adding an item ADDS its
 * vector into the digest, word by word, and removing it subtracts the same
 * vector back out. Both are compute-both-sides-and-compare against a digest
 * recomputed from scratch, so the page never claims the two agree.
 */
import {
  DuplicateItemError,
  LtHash,
  type LtHashParams,
  type Mode,
  firstDifference,
  toHex,
  wordsToBytes,
} from '../lthash/lthash';
import {
  button,
  clear,
  disclosure,
  field,
  h,
  learnerCheck,
  note,
  panelIntro,
  reducedLabel,
  select,
  stat,
  statList,
  verdict,
  wordCells,
} from './dom';

interface State {
  params: LtHashParams;
  mode: Mode;
  hash: LtHash;
  /** The last action, for the "what just happened" card. */
  last: { op: 'add' | 'remove'; name: string; vector: Uint32Array; before: Uint32Array; changed: Set<number> } | null;
  error: string | null;
}

const N_OPTIONS = [4, 6, 8, 12, 16];
const D_OPTIONS = [1, 2, 4, 6, 8, 16];

function freshState(params: LtHashParams, mode: Mode): State {
  const hash = new LtHash(params, mode);
  for (const name of ['apples', 'bread', 'cheese']) hash.add(name);
  return { params, mode, hash, last: null, error: null };
}

function changedWords(before: Uint32Array, after: Uint32Array): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < after.length; i++) if (before[i] !== after[i]) out.add(i);
  return out;
}

export function renderUpdatePanel(root: HTMLElement): void {
  let state = freshState({ N: 8, d: 6 }, 'set');
  const output = h('div', { class: 'output results', id: 'update-results' });

  const rebuild = (params: LtHashParams, mode: Mode): void => {
    state = freshState(params, mode);
    draw();
  };

  const act = (op: 'add' | 'remove', name: string): void => {
    const trimmed = name.trim();
    if (trimmed === '') {
      state.error = 'Type an item first: an empty string is not an item this panel will hash.';
      state.last = null;
      drawOutput();
      return;
    }
    const before = state.hash.digest;
    try {
      const vector = op === 'add' ? state.hash.add(trimmed) : state.hash.remove(trimmed);
      state.error = null;
      state.last = { op, name: trimmed, vector, before, changed: changedWords(before, state.hash.digest) };
    } catch (err) {
      state.error = err instanceof DuplicateItemError ? err.message : String(err);
      state.last = null;
    }
    // Only the output is redrawn. Rebuilding the controls here would reset the
    // item box to its default — so typing an item, adding it and then pressing
    // Remove would remove something else — and it would drop focus after every
    // press, which is worse for a keyboard reader than for a mouse one.
    drawOutput();
  };

  function drawOutput(): void {
    clear(output);
    const { params, hash } = state;
    const digest = hash.digest;
    const scratch = hash.recomputeFromScratch();
    const diff = firstDifference(digest, scratch);
    const members = hash.list().filter((e) => e.count !== 0);

    if (state.error) {
      output.append(
        h('p', { class: 'callout callout-danger', role: 'status', 'aria-live': 'polite', id: 'update-error' }, state.error),
      );
    }

    // ── What the last action did, word by word ──────────────────────────
    if (state.last) {
      const { op, name, vector, before, changed } = state.last;
      output.append(
        h(
          'div',
          { class: 'card', id: 'update-last' },
          h('h3', {}, `${op === 'add' ? 'Added' : 'Removed'} “${name}”`),
          h(
            'p',
            { class: 'help' },
            op === 'add'
              ? 'Its vector was added into the digest, one word at a time, modulo 2^' + params.d + '.'
              : 'Its vector was subtracted back out of the digest, one word at a time, modulo 2^' + params.d + '.',
          ),
          h('p', { class: 'field-label' }, 'digest before'),
          wordCells(before, { label: 'digest words before the action' }),
          h('p', { class: 'field-label' }, `${op === 'add' ? '+' : '−'} H(“${name}”)`),
          wordCells(vector, { label: `vector of the item ${name}`, plus: op === 'add' }),
          h('p', { class: 'field-label' }, 'digest after'),
          wordCells(digest, { changed, label: 'digest words after the action' }),
        ),
      );
    } else {
      output.append(
        h(
          'div',
          { class: 'card', id: 'update-current' },
          h('h3', {}, 'The digest right now'),
          wordCells(digest, { label: 'digest words' }),
        ),
      );
    }

    // ── Compute both sides: running vs recomputed from scratch ──────────
    output.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Running digest against a digest recomputed from scratch'),
        h(
          'p',
          { class: 'help' },
          'The left column is the digest maintained by adding and subtracting as you went. The right column is Σ H(x) over every item, computed again from the items. They are compared word for word.',
        ),
        field('maintained incrementally', toHex(wordsToBytes(digest))),
        field('recomputed from scratch', toHex(wordsToBytes(scratch))),
        diff === -1
          ? verdict(
              'update-consistency',
              'pass',
              `MATCH — all ${params.N} words agree, so the incremental updates landed exactly where a full recomputation does`,
            )
          : verdict(
              'update-consistency',
              'fail',
              `MISMATCH at word ${diff}: incremental says ${digest[diff]}, recomputation says ${scratch[diff]}`,
            ),
      ),
    );

    // ── The two algebraic facts, each computed on both sides ────────────
    // Replay the signed counts so both examples start from the learner's actual state.
    function replay(entries: typeof members): LtHash {
      const copy = new LtHash(params, state.mode);
      for (const { name, count } of entries) {
        for (let i = 0; i < Math.abs(count); i++) {
          if (count > 0) copy.add(name);
          else copy.remove(name);
        }
      }
      return copy;
    }
    const trip = replay(members);
    const forwards = trip.digest;
    const backwards = replay([...members].reverse()).digest;
    const orderDiff = firstDifference(forwards, backwards);
    const occupied = new Set(members.map((entry) => entry.name));
    let probe = 'a-new-item';
    for (let suffix = 2; occupied.has(probe); suffix++) probe = `a-new-item-${suffix}`;
    const tripBase = trip.digest;
    trip.add(probe);
    const withProbe = trip.digest;
    trip.remove(probe);
    const undone = trip.digest;
    const undoneDiff = firstDifference(tripBase, undone);

    output.append(
      h(
        'div',
        { class: 'card-grid' },
        h(
          'div',
          { class: 'card' },
          h('h3', {}, 'Order does not matter'),
          h('p', { class: 'help' }, `Replay the signed counts for the ${members.length} distinct tracked items in forward and reverse order. Each copy contributes to the digest, and removal subtracts a copy.`),
          field('in order', toHex(wordsToBytes(forwards))),
          field('reversed', toHex(wordsToBytes(backwards))),
          orderDiff === -1
            ? verdict('order-invariance', 'pass', 'IDENTICAL — the digest does not depend on the order the items arrived in')
            : verdict('order-invariance', 'fail', `DIFFERENT at word ${orderDiff}: the digest depends on arrival order`),
        ),
        h(
          'div',
          { class: 'card' },
          h('h3', {}, 'Removing undoes adding'),
          h('p', { class: 'help' }, `“${probe}” is added to a fresh state holding the same items and then removed again, through the same add and remove the controls above drive. Subtraction modulo 2^${params.d} is the exact inverse of addition, so the digest has to come back.`),
          field('after adding', toHex(wordsToBytes(withProbe))),
          field('after removing again', toHex(wordsToBytes(undone))),
          undoneDiff === -1
            ? verdict('remove-undoes-add', 'pass', 'BACK TO THE START — every word returned to its value before the addition')
            : verdict('remove-undoes-add', 'fail', `STILL DIFFERENT at word ${undoneDiff}: removing did not undo adding`),
        ),
      ),
    );

    // ── The measurements ────────────────────────────────────────────────
    output.append(
      statList(
        stat('update-item-count', 'DISTINCT ITEMS WITH NONZERO COUNTS', String(members.length), members.length),
        stat('update-word-count', 'WORDS IN THE DIGEST', String(params.N), params.N),
        stat('update-modulus', 'ARITHMETIC MODULO', `2^${params.d} = ${2 ** params.d}`, 2 ** params.d),
        stat('update-queries', 'HASH QUERIES SO FAR', state.hash.queries.toLocaleString('en-US'), state.hash.queries),
      ),
    );

    const negatives = members.filter((e) => e.count < 0);
    if (negatives.length > 0) {
      output.append(
        note(
          'caveat',
          `You removed ${negatives.map((e) => `“${e.name}”`).join(', ')} more times than you added them. The construction cannot refuse that: subtraction is defined for every vector, so the digest simply moved and no error is possible. The digest above is still exactly Σ H(x) over the signed counts, which is why the comparison still agrees.`,
        ),
      );
    }

    output.append(
      h(
        'ul',
        { class: 'words', role: 'list', 'aria-label': 'items currently tracked' },
        ...members.map((e) =>
          h(
            'li',
            { class: 'word word-wide', role: 'listitem' },
            h('span', { class: 'word-idx' }, e.count === 1 ? 'in set' : `count ${e.count}`),
            h('span', { class: 'word-val' }, e.name),
          ),
        ),
      ),
    );
  }

  function draw(): void {
    clear(root);
    const itemInput = h('input', {
      type: 'text',
      id: 'update-item',
      class: 'text-input',
      value: 'dates',
      'aria-describedby': 'update-item-help',
    }) as HTMLInputElement;

    root.append(
      panelIntro(
        'A hash you can update',
        'A normal hash has to read the whole database again every time one row changes. This one does not.',
        'LtHash turns each item into a long row of small numbers and adds those rows up. Because the digest is just a sum, adding an item to the set means adding its row, and removing an item means subtracting the same row back out. Nothing else is recomputed.',
        'Add and remove items below and watch which words of the digest move. Every claim on this page is checked by computing the digest a second way and comparing, so you never have to take the arithmetic on trust.',
      ),
      reducedLabel(state.params.N, state.params.d),
      h(
        'div',
        { class: 'controls' },
        h(
          'div',
          { class: 'control-row' },
          select(
            'update-n',
            'Words in the digest (N)',
            N_OPTIONS.map((n) => ({ value: String(n), text: String(n) })),
            String(state.params.N),
            (v) => rebuild({ N: Number(v), d: state.params.d }, state.mode),
          ),
          select(
            'update-d',
            'Bits per word (d)',
            D_OPTIONS.map((n) => ({ value: String(n), text: `${n} (modulo 2^${n})` })),
            String(state.params.d),
            (v) => rebuild({ N: state.params.N, d: Number(v) }, state.mode),
          ),
          h(
            'div',
            { class: 'control' },
            h('span', { class: 'control-label', id: 'update-mode-label' }, 'Domain'),
            h(
              'div',
              { class: 'radio-row', role: 'group', 'aria-labelledby': 'update-mode-label' },
              ...(['set', 'multiset'] as Mode[]).map((m) =>
                h(
                  'label',
                  { class: 'radio' },
                  h('input', {
                    type: 'radio',
                    name: 'update-mode',
                    value: m,
                    checked: state.mode === m,
                    onchange: () => rebuild(state.params, m),
                  }),
                  m === 'set' ? 'set (an item once)' : 'multiset (repeats allowed)',
                ),
              ),
            ),
          ),
        ),
        h(
          'div',
          { class: 'control' },
          h('label', { for: 'update-item' }, 'Item'),
          h('div', { class: 'input-row' }, itemInput, button('Add', () => act('add', itemInput.value), { kind: 'primary', id: 'update-add' }), button('Remove', () => act('remove', itemInput.value), { id: 'update-remove' }), button('Reset', () => rebuild(state.params, state.mode), { id: 'update-reset' })),
          h(
            'p',
            { class: 'help', id: 'update-item-help' },
            'The item is hashed as its UTF-8 bytes. In set mode the same item cannot be added twice; in multiset mode it can, and the digest moves again.',
          ),
        ),
      ),
      output,
      disclosure(
        'Where the numbers come from',
        h(
          'p',
          {},
          `Each item is expanded with BLAKE2Xb to 2,048 bytes, read as 1,024 little-endian 16-bit words. This reduced instance takes the first ${state.params.N} of those words and keeps the low ${state.params.d} bits of each, so it is a projection of the deployed expansion rather than a different hash.`,
        ),
        h(
          'p',
          {},
          'The empty set hashes to all zeros, which is the identity for addition. That is a design consequence, not a bug: a sum over no items is zero.',
        ),
      ),
      learnerCheck(
        'Two servers hold the same set but received the items in different orders. Do their digests agree?',
        [
          { label: 'Yes, they agree', correct: true },
          { label: 'No, order changes the digest', correct: false },
        ],
        'They agree. The digest is a sum, and addition is commutative, so arrival order cannot change it. That is exactly what makes the hash usable for comparing two replicas that saw the same updates in different orders — and it is also the first hint that the structure an attacker can exploit is linearity.',
      ),
      note(
        'scope',
        'What this is not: this panel is not the deployed instance, and the sizes offered here are far too small to be secure. Switch to “The Real One” for N = 1024, d = 16 checked against its reference vector.',
      ),
    );
    drawOutput();
  }

  draw();
}
