/**
 * Exhibit 4 — Cancel them all.
 *
 * The "aha": press "cancel the next bit" and watch the working modulus fall
 * from 2^d to 2^(d−1) … to 1 while the list of base items behind the surviving
 * vector changes under you. When the modulus reaches 1 the surviving vector is
 * all zeros, and the items behind it are a set whose LtHash digest is zero.
 *
 * The zero is never claimed by the code that produced it. "Re-hash the set"
 * hands the items to src/check/verify.ts, which imports only the hash, re-hashes
 * every item from scratch and compares all N words.
 */
import { OneBitRecursion, AttackSizeError, QUERY_CAP, log2Big, oneBitQueryCount } from '../attack/onebit';
import { verifyCollision, type CollisionVerdict } from '../check/verify';
import { DEPLOYED, HashOracle, type LtHashParams, toHex, utf8, wordsToBytes } from '../lthash/lthash';
import {
  button,
  clear,
  disclosure,
  field,
  h,
  learnerCheck,
  note,
  panelIntro,
  progress,
  reducedLabel,
  select,
  short,
  stat,
  statList,
  tableRegion,
  verdict,
  wordCells,
} from './dom';

const SIZES = [
  { value: '4,2', text: 'N = 4, d = 2 — 25 items' },
  { value: '4,4', text: 'N = 4, d = 4 — 625 items' },
  { value: '6,4', text: 'N = 6, d = 4 — 2,401 items' },
  { value: '6,6', text: 'N = 6, d = 6 — 117,649 items' },
  { value: '8,6', text: 'N = 8, d = 6 — 531,441 items' },
  { value: '8,8', text: 'N = 8, d = 8 — 43,046,721 items (over the cap)' },
];

interface LevelRow {
  level: number;
  before: number;
  after: number;
  groups: number;
  survivorItems: number;
}

export function renderRecursionPanel(root: HTMLElement): void {
  let params: LtHashParams = { N: 4, d: 4 };
  let run: OneBitRecursion | null = null;
  let oracle = new HashOracle(params);
  let sizeError: string | null = null;
  let levels: LevelRow[] = [];
  let checked: CollisionVerdict | null = null;
  let unionChecked: CollisionVerdict | null = null;
  let token = 0;
  let preparing = false;

  const output = h('div', { class: 'output results', id: 'recursion-results' });
  const bar = progress('Base items hashed');

  const reset = (next: LtHashParams): void => {
    params = next;
    levels = [];
    checked = null;
    unionChecked = null;
    sizeError = null;
    run = null;
    oracle = new HashOracle(params);
    void prepare();
  };

  async function prepare(): Promise<void> {
    const mine = ++token;
    preparing = true;
    try {
      run = new OneBitRecursion(params, oracle);
    } catch (err) {
      run = null;
      preparing = false;
      sizeError = err instanceof AttackSizeError ? err.message : String(err);
      draw();
      return;
    }
    draw();
    const chunk = 20_000;
    while (run && !run.ready) {
      run.hashChunk(chunk);
      bar.set(run.hashed, run.total);
      if (run.total > chunk) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (mine !== token) return;
      }
    }
    preparing = false;
    draw();
  }

  const cancelBit = (): void => {
    if (!run || !run.ready || run.done) return;
    const trace = run.cancelNextBit();
    levels.push({
      level: trace.level,
      before: trace.modulusBitsBefore,
      after: trace.modulusBitsAfter,
      groups: trace.groups,
      survivorItems: run.survivorItems().length,
    });
    // Output only: rebuilding the panel would move focus off the button the
    // reader just pressed, once per cancelled bit.
    drawOutput();
  };

  const cancelAll = (): void => {
    while (run && run.ready && !run.done) cancelBit();
  };

  const check = (): void => {
    if (!run || !run.done) return;
    const result = run.result();
    checked = verifyCollision(params, result.items, []);
    const T = ['side-0', 'side-1', 'side-2'].map(utf8);
    unionChecked = verifyCollision(params, [...result.items, ...T], T);
    drawOutput();
  };

  function drawOutput(): void {
    clear(output);
    if (sizeError) {
      output.append(
        verdict('recursion-size', 'fail', `REFUSED — ${sizeError}`),
        note(
          'info',
          `The refusal is the lesson: the number of items the one-bit recursion needs is exactly (N + 1)^d, and that is already ${QUERY_CAP.toLocaleString('en-US')} at sizes a browser tab can hold. The deployed instance needs the number at the bottom of this panel.`,
        ),
      );
      return;
    }
    if (!run) return;

    const ready = run.ready;
    const done = run.done;
    const survivor = ready ? run.survivor() : null;
    const items = ready ? run.survivorItems().length : 0;

    output.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, ready ? 'The working modulus' : 'Hashing the base items'),
        ready
          ? h(
              'p',
              { class: 'help' },
              done
                ? 'Every bit is cancelled. The modulus is 1, which leaves exactly one value: zero.'
                : `Each press takes every group of ${params.N + 1} vectors at the current level, finds the subset that sums to something even in every word, and halves it. One bit of the modulus goes with each press.`,
            )
          : bar.el,
        ready
          ? statList(
              stat('recursion-modulus', 'WORKING MODULUS', run.modulusBits === 0 ? '1' : `2^${run.modulusBits}`, 2 ** run.modulusBits),
              stat('recursion-bits-cancelled', 'BITS CANCELLED', `${run.bitsCancelled} of ${params.d}`, run.bitsCancelled),
              stat('recursion-vectors', 'VECTORS AT THIS LEVEL', run.vectorCount.toLocaleString('en-US'), run.vectorCount),
              stat('recursion-survivor-items', 'BASE ITEMS BEHIND THE SURVIVOR', items.toLocaleString('en-US'), items),
            )
          : null,
        survivor
          ? h(
              'div',
              {},
              h('p', { class: 'field-label' }, `the surviving vector, modulo ${run.modulusBits === 0 ? '1' : `2^${run.modulusBits}`}`),
              wordCells(survivor, { limit: 24, label: 'the surviving vector' }),
            )
          : null,
        h(
          'div',
          { class: 'input-row' },
          button(done ? 'Every bit cancelled' : 'Cancel the next bit', cancelBit, { kind: 'primary', id: 'recursion-step' }),
          button('Cancel the rest', cancelAll, { id: 'recursion-all' }),
          button('Start over', () => reset(params), { id: 'recursion-reset' }),
        ),
      ),
    );

    const stepBtn = output.querySelector('#recursion-step') as HTMLButtonElement | null;
    if (stepBtn) stepBtn.disabled = !ready || done;
    const allBtn = output.querySelector('#recursion-all') as HTMLButtonElement | null;
    if (allBtn) allBtn.disabled = !ready || done;

    if (levels.length > 0) {
      output.append(
        tableRegion(
          'Levels completed',
          h(
            'table',
            { class: 'grid-table' },
            h('caption', {}, 'One row per cancelled bit'),
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', { scope: 'col' }, 'bit'),
                h('th', { scope: 'col' }, 'modulus before'),
                h('th', { scope: 'col' }, 'modulus after'),
                h('th', { scope: 'col' }, 'groups eliminated'),
                h('th', { scope: 'col' }, 'items behind survivor'),
              ),
            ),
            h(
              'tbody',
              {},
              ...levels.map((l) =>
                h(
                  'tr',
                  {},
                  h('th', { scope: 'row' }, String(l.level)),
                  h('td', {}, `2^${l.before}`),
                  h('td', {}, l.after === 0 ? '1' : `2^${l.after}`),
                  h('td', {}, l.groups.toLocaleString('en-US')),
                  h('td', {}, l.survivorItems.toLocaleString('en-US')),
                ),
              ),
            ),
          ),
        ),
        h(
          'p',
          { class: 'help' },
          'The item count is not monotone, and this page does not pretend it is: when a single vector happens to be even in every word already, the subset can be just that one vector and the survivor inherits only its items. What is guaranteed is that the list is never empty.',
        ),
      );
    }

    // ── The independent check ──────────────────────────────────────────
    if (done) {
      const result = run.result();
      output.append(
        h(
          'div',
          { class: 'card' },
          h('h3', {}, 'Re-hash the set from scratch'),
          h(
            'p',
            { class: 'help' },
            `The recursion says these ${result.items.length.toLocaleString('en-US')} items sum to zero. It does not get to be the one that confirms it: pressing the button hands the item names to a checker that imports only the hash, re-hashes every item, adds the vectors itself and compares all ${params.N} words.`,
          ),
          field('items in the set (first few)', result.names.slice(0, 8).join(', ') + (result.names.length > 8 ? `, … and ${result.names.length - 8} more` : '')),
          h('div', { class: 'input-row' }, button('Re-hash the set', check, { kind: 'primary', id: 'recursion-check' })),
          checked
            ? h(
                'div',
                {},
                h('p', { class: 'field-label' }, 'the digest the checker computed'),
                wordCells(checked.digestA, { limit: 24, label: 'the independently recomputed digest' }),
                field('as hex', short(toHex(wordsToBytes(checked.digestA)), 24)),
                checked.ok
                  ? verdict(
                      'collision-zero',
                      'alarm',
                      `ALL ${params.N} WORDS ZERO — this non-empty set of ${result.items.length.toLocaleString('en-US')} distinct items has the same digest as the empty set`,
                    )
                  : verdict('collision-zero', 'fail', `NOT A COLLISION — ${checked.reason}`),
              )
            : verdict('collision-zero', 'pending', 'Nothing checked yet: press “Re-hash the set”.'),
          unionChecked
            ? unionChecked.ok
              ? verdict(
                  'collision-union',
                  'alarm',
                  `AND S ∪ T COLLIDES WITH T — adding the same three unrelated items to both sides leaves ${params.N} of ${params.N} words equal, so the collision is not an artefact of comparing against the empty set`,
                )
              : verdict('collision-union', 'fail', `S ∪ T DID NOT COLLIDE WITH T — ${unionChecked.reason}`)
            : null,
          checked
            ? statList(
                stat('verify-rehashed', 'ITEMS RE-HASHED BY THE CHECKER', checked.rehashed.toLocaleString('en-US'), checked.rehashed),
                stat('verify-words-compared', 'WORDS COMPARED', String(checked.wordsCompared), checked.wordsCompared),
                stat('verify-set-size', 'ITEMS IN THE COLLIDING SET', result.items.length.toLocaleString('en-US'), result.items.length),
              )
            : null,
        ),
      );
    }

    // ── The counts ─────────────────────────────────────────────────────
    const formula = oneBitQueryCount(params);
    const deployed = oneBitQueryCount(DEPLOYED);
    output.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'What it cost, and what it would cost'),
        h(
          'p',
          { class: 'help' },
          'Every base item is one hash query, and the recursion needs exactly (N + 1)^d of them. The measured count is the number of calls this page actually made.',
        ),
        statList(
          stat('recursion-measured-queries', 'HASH QUERIES MEASURED', run.queries.toLocaleString('en-US'), run.queries),
          stat('recursion-formula-queries', `(N + 1)^d = ${params.N + 1}^${params.d}`, formula.toLocaleString('en-US'), formula.toString()),
          stat('recursion-deployed-queries', 'THE SAME FORMULA AT N = 1024, d = 16', `1025^16 = ${deployed.toString()}`, deployed.toString(), true),
          stat('recursion-deployed-log2', 'WHICH IS ABOUT', `2^${log2Big(deployed).toFixed(2)}`, log2Big(deployed).toFixed(2)),
        ),
        note(
          'caveat',
          `That last number is why this exhibit stops at reduced sizes. 2^${log2Big(deployed).toFixed(0)} hash queries is not a long wait, it is unreachable. The one-bit recursion is a polynomial-time algorithm that still does not break the deployed instance — and the next exhibit is the paper that cuts the exponent roughly in half.`,
        ),
      ),
    );
  }

  function draw(): void {
    clear(root);
    root.append(
      panelIntro(
        'Cancel them all',
        'One cancelled bit is a curiosity. Cancelling every bit produces a set of items whose digest is zero.',
        `Build ${params.N + 1} groups of ${params.N + 1} vectors, cancel a bit in each, and you have ${params.N + 1} vectors in a modulus one bit smaller — each remembering the items behind it. Repeat ${params.d} times and one vector remains, modulo 1, which can only be zero. The items behind it are a set that hashes to the same value as the empty set.`,
        'Press the button below and watch the modulus fall. Then make the page prove it, by handing the items to a checker that knows nothing about how they were found.',
      ),
      reducedLabel(params.N, params.d),
      h(
        'div',
        { class: 'controls' },
        h(
          'div',
          { class: 'control-row' },
          select('recursion-size', 'Instance size', SIZES, `${params.N},${params.d}`, (v) => {
            const [N, d] = v.split(',').map(Number);
            reset({ N, d });
          }),
        ),
        h(
          'p',
          { class: 'help' },
          preparing ? 'Hashing the base items…' : 'Larger sizes hash more items before the first bit can be cancelled. The last option is deliberately over this page’s cap, to show what the refusal looks like.',
        ),
      ),
      output,
      disclosure(
        'What the recursion is carrying along',
        h(
          'p',
          {},
          'Each vector at each level keeps the list of base items it was built from, and the lists of different vectors never overlap. That is what keeps the final coefficients at 0 or 1: a base item reaches the end through at most one path, so it is either in the set or not, never in it twice.',
        ),
        h(
          'p',
          {},
          'The result is a set, not a multiset, and the page enforces that: a repeated base item would make the result a multiset and is treated as a failure rather than reported as a collision.',
        ),
        h(
          'p',
          {},
          'Because a kernel vector always exists, there is no probability here. Every run at every size finds a collision; only the cost grows.',
        ),
      ),
      learnerCheck(
        'The recursion needs (N + 1)^d items. Which change makes the attack harder — doubling N, or doubling d?',
        [
          { label: 'Doubling d', correct: true },
          { label: 'Doubling N', correct: false },
        ],
        'Doubling d, by far. N sits in the base and d in the exponent, so more words raise the cost polynomially while more bits per word raise it exponentially. That is also why the paper’s improvement matters so much: it halves the exponent, which is worth more than any realistic increase in N.',
      ),
      note(
        'scope',
        'What this is not: a result about the deployed instance. These collisions are for a reduced-size instance of a few words and a few bits. The cost at N = 1024, d = 16 is the 49-digit number above.',
      ),
    );
    drawOutput();
  }

  void prepare();
}
