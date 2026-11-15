/**
 * Exhibit 3 — Cancel one bit.
 *
 * The step the whole attack is built from, at a size you can read. N + 1 items
 * are hashed; their low bits form an N × (N + 1) matrix over the two-element
 * field; a matrix with more columns than rows always has a non-zero kernel
 * vector, and that vector names a subset of the items whose vectors sum to an
 * even number in every word. Halve that sum and the result lives modulo
 * 2^(d−1): one modulus bit is gone.
 *
 * The elimination is replayed step by step on the matrix the page is showing,
 * not described in prose.
 */
import { type EliminationStep, fromColumns, kernelVector, parity } from '../attack/gf2';
import { HashOracle, type LtHashParams, reduceWord } from '../lthash/lthash';
import { baseItem, baseItemName } from '../attack/onebit';
import {
  button,
  clear,
  disclosure,
  h,
  learnerCheck,
  note,
  panelIntro,
  reducedLabel,
  select,
  stat,
  statList,
  tableRegion,
  verdict,
  wordCells,
} from './dom';

const N_OPTIONS = [4, 6, 8];
const D_OPTIONS = [2, 4, 6, 8];

interface Prepared {
  params: LtHashParams;
  vectors: Uint32Array[];
  matrix: Uint8Array[];
  steps: EliminationStep[];
  kernel: Uint8Array;
  subset: number[];
  sum: Uint32Array;
  halved: Uint32Array;
  allEven: boolean;
  queries: number;
}

function prepare(params: LtHashParams): Prepared {
  const oracle = new HashOracle(params);
  const vectors: Uint32Array[] = [];
  for (let i = 0; i <= params.N; i++) vectors.push(oracle.hash(baseItem(i)));
  const matrix = fromColumns(vectors.map(parity), params.N);
  const { vector: kernel, rref } = kernelVector(matrix, true);
  const subset: number[] = [];
  for (let j = 0; j <= params.N; j++) if (kernel[j]) subset.push(j);
  const sum = new Uint32Array(params.N);
  for (const j of subset) for (let i = 0; i < params.N; i++) sum[i] += vectors[j][i];
  const allEven = [...sum].every((w) => w % 2 === 0);
  const halved = new Uint32Array(params.N);
  for (let i = 0; i < params.N; i++) halved[i] = reduceWord(Math.floor(sum[i] / 2), params.d - 1);
  return { params, vectors, matrix, steps: rref.steps, kernel, subset, sum, halved, allEven, queries: oracle.queries };
}

/** Apply one recorded elimination step to a working copy of the matrix. */
function applyStep(rows: Uint8Array[], step: EliminationStep): void {
  if (step.kind === 'swap' && step.other !== undefined) {
    const tmp = rows[step.row];
    rows[step.row] = rows[step.other];
    rows[step.other] = tmp;
  } else if (step.kind === 'xor' && step.other !== undefined) {
    const target = rows[step.row];
    const source = rows[step.other];
    for (let j = 0; j < target.length; j++) target[j] ^= source[j];
  }
}

function describeStep(step: EliminationStep): string {
  if (step.kind === 'swap') return `swap row ${step.row} with row ${step.other} — the pivot for column ${step.row} was lower down`;
  if (step.kind === 'pivot') return `row ${step.row} is the pivot for column ${step.col}`;
  return `add row ${step.other} into row ${step.row}, clearing its 1 in column ${step.col}`;
}

export function renderOneBitPanel(root: HTMLElement): void {
  let params: LtHashParams = { N: 4, d: 6 };
  let data = prepare(params);
  let cursor = 0;
  const output = h('div', { class: 'output results', id: 'onebit-results' });

  const setParams = (next: LtHashParams): void => {
    params = next;
    data = prepare(params);
    cursor = 0;
    draw();
  };

  function matrixTable(rows: readonly Uint8Array[], highlight: boolean): HTMLElement {
    const head = h(
      'tr',
      {},
      h('th', { scope: 'col' }, 'word'),
      ...Array.from({ length: params.N + 1 }, (_, j) =>
        h('th', { scope: 'col', class: highlight && data.kernel[j] ? 'col-in' : undefined }, `v${j}`),
      ),
    );
    const body = rows.map((row, i) =>
      h(
        'tr',
        {},
        h('th', { scope: 'row' }, String(i)),
        ...Array.from({ length: params.N + 1 }, (_, j) =>
          h('td', { class: highlight && data.kernel[j] ? 'cell-in' : undefined }, String(row[j])),
        ),
      ),
    );
    return h(
      'table',
      { class: 'grid-table' },
      h(
        'caption',
        {},
        `Low bit of every word of every vector: ${params.N} rows, ${params.N + 1} columns.${highlight ? ' The highlighted columns are the subset the elimination found.' : ''}`,
      ),
      h('thead', {}, head),
      h('tbody', {}, ...body),
    );
  }

  function drawOutput(): void {
    clear(output);
    const working = data.matrix.map((r) => Uint8Array.from(r));
    for (let k = 0; k < cursor; k++) applyStep(working, data.steps[k]);
    const finished = cursor >= data.steps.length;
    const current = cursor === 0 ? null : data.steps[cursor - 1];

    output.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, `The ${params.N + 1} vectors, as words modulo 2^${params.d}`),
        h(
          'p',
          { class: 'help' },
          `Each column below is one item's vector: item-0 to item-${params.N}. Only the low bit of each number matters for the next step, because the question is which subset adds up to something even.`,
        ),
        tableRegion(
          'The hashed vectors',
          h(
            'table',
            { class: 'grid-table' },
            h('caption', {}, `H(item-j) for j = 0 to ${params.N}`),
            h(
              'thead',
              {},
              h('tr', {}, h('th', { scope: 'col' }, 'word'), ...data.vectors.map((_, j) => h('th', { scope: 'col' }, `v${j}`))),
            ),
            h(
              'tbody',
              {},
              ...Array.from({ length: params.N }, (_, i) =>
                h(
                  'tr',
                  {},
                  h('th', { scope: 'row' }, String(i)),
                  ...data.vectors.map((v) => h('td', {}, String(v[i]))),
                ),
              ),
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'The elimination, one step at a time'),
        h(
          'p',
          { class: 'help' },
          `There are ${params.N + 1} columns and only ${params.N} rows, so the columns cannot be independent: some non-empty subset of them adds to zero modulo two. Gaussian elimination finds one. ${data.steps.length} steps in all.`,
        ),
        tableRegion('The parity matrix during elimination', matrixTable(working, finished)),
        h(
          'p',
          { class: 'progress-label', role: 'status', 'aria-live': 'polite', id: 'onebit-step-status' },
          current === null
            ? `Step 0 of ${data.steps.length}: the matrix as hashed, before any elimination.`
            : `Step ${cursor} of ${data.steps.length}: ${describeStep(current)}.`,
        ),
        h(
          'div',
          { class: 'input-row' },
          button('Next step', () => {
            if (cursor < data.steps.length) cursor += 1;
            drawOutput();
          }, { kind: 'primary', id: 'onebit-next' }),
          button('Run to the end', () => {
            cursor = data.steps.length;
            drawOutput();
          }, { id: 'onebit-run' }),
          button('Back to the start', () => {
            cursor = 0;
            drawOutput();
          }, { id: 'onebit-reset' }),
        ),
      ),
    );

    const nextBtn = output.querySelector('#onebit-next') as HTMLButtonElement | null;
    if (nextBtn && finished) nextBtn.disabled = true;

    // ── The subset, its even sum, and the halving ───────────────────────
    output.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, `The subset: ${data.subset.map((j) => baseItemName(j)).join(', ')}`),
        h(
          'p',
          { class: 'help' },
          `The kernel vector picks ${data.subset.length} of the ${params.N + 1} items. Adding their vectors gives a number in every word that is divisible by two — shown below as plain integers, before any reduction.`,
        ),
        h('p', { class: 'field-label' }, 'sum over the subset, as integers'),
        wordCells(data.sum, { label: 'the subset sum, word by word' }),
        data.allEven
          ? verdict(
              'parity-cancelled',
              'pass',
              `EVEN IN ALL ${params.N} WORDS — every word of the subset sum is divisible by two, so the sum can be halved`,
            )
          : verdict('parity-cancelled', 'fail', 'ODD SOMEWHERE — the subset sum is not divisible by two in every word'),
        h('p', { class: 'field-label' }, `the sum halved, now modulo 2^${params.d - 1}`),
        wordCells(data.halved, { label: 'the halved vector' }),
        h(
          'p',
          { class: 'help' },
          `That halved vector is one vector modulo 2^${params.d - 1}, and it remembers the ${data.subset.length} items behind it. One modulus bit is gone. Doing this to ${params.N + 1} such vectors at once, over and over, is the whole attack — the next exhibit runs it to the end.`,
        ),
        statList(
          stat('onebit-queries', 'ITEMS HASHED', String(data.queries), data.queries),
          stat('onebit-subset-size', 'ITEMS IN THE SUBSET', String(data.subset.length), data.subset.length),
          stat('onebit-steps', 'ELIMINATION STEPS', String(data.steps.length), data.steps.length),
          stat('onebit-modulus-after', 'MODULUS AFTER HALVING', `2^${params.d - 1}`, 2 ** (params.d - 1)),
        ),
      ),
    );
  }

  function draw(): void {
    clear(root);
    root.append(
      panelIntro(
        'Cancel one bit',
        'Here is the move the attack is made of, small enough to read every number.',
        `Hash ${params.N + 1} items into ${params.N + 1} vectors of ${params.N} words. Write down only the low bit of each number. That is a matrix with more columns than rows, and such a matrix always has a non-zero solution to "which columns add to zero" — so some non-empty subset of the items has a sum that is even in every single word.`,
        'An even number can be halved, and halving a sum that is even in every word gives a vector in a modulus one bit smaller. That is the entire trick, applied once.',
      ),
      reducedLabel(params.N, params.d),
      h(
        'div',
        { class: 'controls' },
        h(
          'div',
          { class: 'control-row' },
          select(
            'onebit-n',
            'Words in the digest (N)',
            N_OPTIONS.map((n) => ({ value: String(n), text: `${n} (so ${n + 1} items)` })),
            String(params.N),
            (v) => setParams({ N: Number(v), d: params.d }),
          ),
          select(
            'onebit-d',
            'Bits per word (d)',
            D_OPTIONS.map((n) => ({ value: String(n), text: `${n} (modulo 2^${n})` })),
            String(params.d),
            (v) => setParams({ N: params.N, d: Number(v) }),
          ),
        ),
      ),
      output,
      disclosure(
        'Why more columns than rows guarantees a subset exists',
        h(
          'p',
          {},
          `The parity vectors live in a space of dimension ${params.N} over the two-element field. Any ${params.N + 1} vectors in an ${params.N}-dimensional space are linearly dependent, so some non-empty combination of them is zero. Over this field a combination is just a subset — the only coefficients are 0 and 1 — so the dependence names a subset of items.`,
        ),
        h(
          'p',
          {},
          'Nothing here is probabilistic. The subset exists for every possible input, which is why the recursion built on it always succeeds rather than succeeding with some probability.',
        ),
        h(
          'p',
          {},
          'The row swap in the elimination is load-bearing: the pivot for a column is rarely already in the row that needs it, and the bookkeeping that reads the answer out assumes the pivot for column c sits in row r.',
        ),
      ),
      learnerCheck(
        'Would this step still work if the words were taken modulo a large prime instead of a power of two?',
        [
          { label: 'No — halving needs the even/odd split', correct: true },
          { label: 'Yes, elimination works over any field', correct: false },
        ],
        'No. Elimination still works, but the point of this step is that the modulus factorises: 2^d has 2 as a factor, so "even in every word" is a meaningful condition and dividing by two lands you in a smaller modulus of the same shape. A prime modulus has no such factor to peel off, which is why the paper recommends large-prime moduli for future designs.',
      ),
      note(
        'scope',
        'What this is not: a collision. One cancelled bit is one step; the set of items behind the halved vector collides with nothing yet.',
      ),
    );
    drawOutput();
  }

  draw();
}
