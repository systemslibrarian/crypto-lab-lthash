/**
 * Exhibit 5 — Two bits at a time.
 *
 * The 2026 paper's improvement, built from the paper rather than described: each
 * layer cancels TWO modulus bits instead of one, by first choosing a subset of a
 * retained basis to kill the parity and then solving a second binary system for
 * SIGNS that push the combination into 4·(Z/2^s)^N. Changing a sign preserves
 * parity (−1 ≡ 1 mod 2), so the first cancellation survives the second step and
 * the coefficients stay in {−1, 0, 1} — which is why the result is two sets, one
 * for the +1 coefficients and one for the −1 coefficients.
 *
 * Acceptance here is self-certifying: the two sets go to the same independent
 * checker as everything else, and the measured query count is compared with
 * (N + 1)^d at the same size. A run that reaches its cap is reported as a
 * failure, because the guarantee is a probability and not a certainty.
 */
import { expectedTwoBitQueries, runTwoBit, type TwoBitResult } from '../attack/twobit';
import { log2Big, oneBitQueryCount } from '../attack/onebit';
import { verifyCollision, type CollisionVerdict } from '../check/verify';
import { DEPLOYED, HashOracle, type LtHashParams } from '../lthash/lthash';
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
  tableRegion,
  verdict,
} from './dom';

const SIZES = [
  { value: '4,4', text: 'N = 4, d = 4' },
  { value: '5,5', text: 'N = 5, d = 5 (odd d: a one-bit layer finishes it)' },
  { value: '6,6', text: 'N = 6, d = 6' },
  { value: '8,6', text: 'N = 8, d = 6' },
  { value: '8,8', text: 'N = 8, d = 8' },
];

/** The paper's own figures for the deployed instance, quoted and attributed. */
const PAPER_FIGURES = [
  { method: 'Generalized birthday (CPW)', queries: '2^167', time: '2^263', note: 'Lewi et al.’s evaluation, reproduced in Table 2' },
  { method: 'Generalized birthday (MS)', queries: '2^133', time: '2^255', note: 'Lewi et al.’s evaluation, reproduced in Table 2' },
  { method: 'Generalized birthday (TSG)', queries: '2^181.04', time: '2^187.54', note: 'the paper’s own evaluation' },
  { method: 'One-bit recursion (Regev–CLZ)', queries: '2^160.02', time: '2^180.03', note: 'the paper’s own evaluation' },
  { method: 'Two-bit lifting, expected', queries: '2^81.07', time: '< 2^100.95', note: 'this paper’s result' },
];

export function renderTwoBitPanel(root: HTMLElement): void {
  let params: LtHashParams = { N: 6, d: 6 };
  let result: TwoBitResult | null = null;
  let checked: CollisionVerdict | null = null;
  let running = false;
  const output = h('div', { class: 'output results', id: 'twobit-results' });

  const run = (): void => {
    running = true;
    const oracle = new HashOracle(params);
    result = runTwoBit(params, oracle);
    checked = result.ok ? verifyCollision(params, result.plusItems, result.minusItems) : null;
    running = false;
    // Output only: the controls above it have not changed, and rebuilding them
    // would move focus off the button that started the run.
    drawOutput();
  };

  function drawOutput(): void {
    clear(output);
    if (!result) {
      output.append(verdict('twobit-collision', 'pending', running ? 'Running the two-bit recursion…' : 'Nothing run yet: press “Run the two-bit recursion”.'));
      return;
    }

    const oneBit = oneBitQueryCount(params);
    const ratio = Number(oneBit) / result.queries;

    if (!result.ok) {
      output.append(
        verdict('twobit-collision', 'fail', `RUN FAILED — ${result.reason}`),
        note(
          'caveat',
          'This is reported as a failure rather than retried into a success. The paper’s guarantee is a probability — at least 3/4 within its column bound, at least 1/2 within its capped budget — so a run that exhausts its budget is a real outcome of the algorithm and the page says so.',
        ),
      );
      return;
    }

    output.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'The two sets'),
        h(
          'p',
          { class: 'help' },
          'The coefficients come out in {−1, 0, 1}, so the relation names two sets rather than one: the items with coefficient +1 and the items with coefficient −1. Their digests are compared by the same checker that judged the one-bit result.',
        ),
        field(`set S — ${result.plusItems.length.toLocaleString('en-US')} items with coefficient +1`, result.plusNames.slice(0, 6).join(', ') + (result.plusNames.length > 6 ? `, … and ${result.plusNames.length - 6} more` : '')),
        field(`set T — ${result.minusItems.length.toLocaleString('en-US')} items with coefficient −1`, result.minusNames.slice(0, 6).join(', ') + (result.minusNames.length > 6 ? `, … and ${result.minusNames.length - 6} more` : '')),
        checked && checked.ok
          ? verdict(
              'twobit-collision',
              'alarm',
              `DIGESTS EQUAL IN ALL ${params.N} WORDS — two different sets, ${result.plusItems.length.toLocaleString('en-US')} items against ${result.minusItems.length.toLocaleString('en-US')}, re-hashed from scratch by the independent checker`,
            )
          : verdict('twobit-collision', 'fail', `NOT A COLLISION — ${checked?.reason ?? 'the checker refused the result'}`),
      ),
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Queries, against the one-bit recursion at the same size'),
        statList(
          stat('twobit-queries', 'TWO-BIT QUERIES MEASURED', result.queries.toLocaleString('en-US'), result.queries),
          stat('twobit-onebit-queries', `ONE-BIT (N + 1)^d = ${params.N + 1}^${params.d}`, oneBit.toLocaleString('en-US'), oneBit.toString()),
          stat('twobit-ratio', 'TIMES FEWER QUERIES', `${ratio.toFixed(1)}×`, ratio.toFixed(1), true),
          stat('twobit-batch', 'BATCH SIZE t', String(result.t), result.t),
        ),
        h(
          'p',
          { class: 'help' },
          `The saving comes from the layer count: ${result.layers.length} two-bit layer${result.layers.length === 1 ? '' : 's'} where the one-bit recursion needs ${params.d}, and each layer costs about N inputs per output instead of N + 1 multiplied again.`,
        ),
      ),
      tableRegion(
        'Per-layer statistics',
        h(
          'table',
          { class: 'grid-table', id: 'twobit-layers' },
          h('caption', {}, 'What each layer consumed. A rejection is a trial batch whose sign system was inconsistent: the basis is kept and a new batch is drawn.'),
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col' }, 'layer'),
              h('th', { scope: 'col' }, 'modulus'),
              h('th', { scope: 'col' }, 'outputs'),
              h('th', { scope: 'col' }, 'inputs used'),
              h('th', { scope: 'col' }, 'attempts'),
              h('th', { scope: 'col' }, 'rejections'),
            ),
          ),
          h(
            'tbody',
            {},
            ...result.layers.map((l, i) =>
              h(
                'tr',
                {},
                h('th', { scope: 'row' }, String(i + 1)),
                h('td', {}, `2^${l.inputModulusBits} → 2^${l.outputModulusBits}`),
                h('td', {}, l.outputs.toLocaleString('en-US')),
                h('td', {}, l.inputsConsumed.toLocaleString('en-US')),
                h('td', {}, l.attempts.toLocaleString('en-US')),
                h('td', {}, l.rejections.toLocaleString('en-US')),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function draw(): void {
    clear(root);
    const deployedCost = expectedTwoBitQueries(1024, 16, 550);
    const deployedOneBit = oneBitQueryCount(DEPLOYED);

    root.append(
      panelIntro(
        'Two bits at a time',
        'The 2026 paper takes two modulus bits per step instead of one, and keeps the coefficients ternary while doing it.',
        'Cancelling two bits naively is easy and useless: combine with coefficients up to 2 and the coefficient bound doubles at every level, so after d/2 levels the relation is no longer a set. The paper’s trick is that flipping a sign does not change a parity, because −1 and +1 are the same thing modulo 2. So it cancels the first bit by choosing a subset, then cancels the second bit by choosing signs — and the coefficients stay in {−1, 0, 1}.',
        'The cost falls from about N^d input columns to about N^⌈d/2⌉. Run it below and compare the measured query count with the one-bit recursion at the same size.',
      ),
      reducedLabel(params.N, params.d),
      h(
        'div',
        { class: 'controls' },
        h(
          'div',
          { class: 'control-row' },
          select('twobit-size', 'Instance size', SIZES, `${params.N},${params.d}`, (v) => {
            const [N, d] = v.split(',').map(Number);
            params = { N, d };
            result = null;
            checked = null;
            draw();
          }),
          h('div', { class: 'control' }, h('span', { class: 'control-label' }, 'Run'), h('div', { class: 'input-row' }, button('Run the two-bit recursion', run, { kind: 'primary', id: 'twobit-run' }))),
        ),
        h(
          'p',
          { class: 'help' },
          'The batch size t defaults to N + 1, which is the schedule the paper’s asymptotic analysis uses. Each run draws fresh items, so the query count moves a little from run to run: it is an expectation, not a fixed figure.',
        ),
      ),
      output,
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'The same arithmetic at the deployed size'),
        h(
          'p',
          { class: 'help' },
          'These are the paper’s own formulas, evaluated here rather than quoted: the one-attempt success probability of equation 8, the affine per-output cost of equation 13, and the eight-layer composition of equation 16 at the batch size the paper minimises to.',
        ),
        statList(
          stat('deployed-p', 'ONE-ATTEMPT ACCEPTANCE PROBABILITY p(1024, 550)', deployedCost.cost.p.toFixed(5), deployedCost.cost.p.toFixed(5)),
          stat('deployed-mu', 'EXPECTED INPUTS PER OUTPUT', deployedCost.cost.mu.toFixed(2), deployedCost.cost.mu.toFixed(2)),
          stat('deployed-expected-log2', 'EXPECTED QUERIES, COMPUTED HERE', `2^${deployedCost.log2Expected.toFixed(2)}`, deployedCost.log2Expected.toFixed(2), true),
          stat('deployed-budget-log2', 'CAPPED BUDGET AT PROBABILITY ≥ 1/2', `2^${deployedCost.log2Budget.toFixed(2)}`, deployedCost.log2Budget.toFixed(2)),
          stat('deployed-onebit-log2', 'ONE-BIT RECURSION, FOR COMPARISON', `2^${log2Big(deployedOneBit).toFixed(2)}`, log2Big(deployedOneBit).toFixed(2)),
        ),
        h(
          'p',
          { class: 'help' },
          'Eight two-bit layers at a batch size of 550, starting from one terminal output: that is the configuration the paper uses for the 16-bit instance, and the number above is what its own recurrence produces when this page evaluates it.',
        ),
      ),
      tableRegion(
        'Collision costs for the deployed instance as the paper reports them',
        h(
          'table',
          { class: 'grid-table text-table' },
          h('caption', {}, 'Quoted from Table 2 of ePrint 2026/2083 — these are the paper’s figures, not measurements made on this page. Only the two-bit query and budget figures above are recomputed here.'),
          h(
            'thead',
            {},
            h('tr', {}, h('th', { scope: 'col' }, 'method'), h('th', { scope: 'col' }, 'queries'), h('th', { scope: 'col' }, 'operations'), h('th', { scope: 'col' }, 'source')),
          ),
          h(
            'tbody',
            {},
            ...PAPER_FIGURES.map((row) =>
              h(
                'tr',
                {},
                h('th', { scope: 'row' }, row.method),
                h('td', { class: 'quoted' }, row.queries),
                h('td', { class: 'quoted' }, row.time),
                h('td', { class: 'quoted' }, row.note),
              ),
            ),
          ),
        ),
      ),
      note(
        'caveat',
        'Against a published claim of at least 200 bits of collision security, the paper reports about 2^81 hash queries and under 2^101 scalar operations over the two-element field. That is still far out of reach of anyone — 2^81 queries is not an afternoon — but it is a different claim from 200 bits, and it is below the 128-bit target the Solana proposal cites.',
      ),
      disclosure(
        'How one layer works, in the order the code does it',
        h('p', {}, 'Fill a basis: pull columns until N of them are independent modulo 2. A column that is already in the span is dropped.'),
        h('p', {}, 'Draw a trial batch of t fresh columns. Solve for the unique subset X of the basis whose parities cancel the batch’s parity sum. The combined sum over X and the batch is then even in every word.'),
        h('p', {}, 'Solve a second binary system for signs: with V the selected basis columns followed by the batch, find y with V̄y = u/2 modulo 2, where u is the all-ones combination. If that system is inconsistent, drop the batch, keep the basis, and draw another.'),
        h('p', {}, 'Merge: with η = 1 − 2y, the combination Vη is divisible by four, so dividing by four removes two modulus bits. The selected basis columns are consumed and the rest are retained for the next output.'),
        h('p', {}, 'For odd d, ⌊d/2⌋ two-bit layers leave one bit, and a single kernel vector among N + 1 outputs modulo 2 finishes the job — which is the one-bit step from the previous exhibit, used once.'),
      ),
      learnerCheck(
        'Why does the sign-flipping step not undo the first cancellation?',
        [
          { label: 'Because −1 and +1 agree modulo 2', correct: true },
          { label: 'Because the signs are chosen before the subset', correct: false },
        ],
        'Because −1 ≡ 1 (mod 2). The first step arranged for the sum to be even in every word, which is a statement about parities only, and flipping a coefficient from +1 to −1 subtracts twice that column — an even change. So the parity condition survives, and the freedom in the signs is exactly what the second binary system spends to reach divisibility by four.',
      ),
      note(
        'scope',
        'What this is not: the deployed attack. The runs above are reduced-size instances; the figures for N = 1024, d = 16 are an evaluation of the paper’s formulas and of its own reported costs, with no collision computed at that size anywhere on this page.',
      ),
    );
    drawOutput();
  }

  draw();
}
