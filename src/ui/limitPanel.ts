/**
 * Exhibit 6 — Updates correct, sets different. The negative-claim exhibit.
 *
 * The negative claim, scoped to the instance on this page: correct incremental
 * updating says nothing about collision resistance. For this reduced
 * power-of-two instance, two different sets have the same digest.
 *
 * The fixture is a state in which EVERY check the page performs reports
 * success — each digest recomputed from scratch equals its incrementally
 * maintained value, add-then-remove round-trips on both sets — and the named
 * property is violated anyway, because the two digests are equal and the sets
 * are not. The construction has no failure code to raise, and the page says so:
 * the absence of a code is the exhibit.
 */
import { runTwoBit, type TwoBitResult } from '../attack/twobit';
import { verifyCollision, type CollisionVerdict } from '../check/verify';
import {
  HashOracle,
  LtHash,
  type LtHashParams,
  digestOf,
  firstDifference,
  toHex,
  wordsEqual,
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
  short,
  stat,
  statList,
  verdict,
  wordCells,
} from './dom';

export const NEGATIVE_CLAIM =
  'Correct incremental updating says nothing about collision resistance: for this reduced power-of-two instance, two different sets have the same digest.';

interface Fixture {
  params: LtHashParams;
  result: TwoBitResult;
  checked: CollisionVerdict;
  /** Per set: incremental digest, from-scratch digest, and the round-trip digest. */
  sides: {
    label: string;
    names: string[];
    incremental: Uint32Array;
    scratch: Uint32Array;
    roundTrip: Uint32Array;
    consistent: boolean;
    roundTrips: boolean;
  }[];
}

function buildFixture(params: LtHashParams): Fixture | null {
  const oracle = new HashOracle(params);
  const result = runTwoBit(params, oracle);
  if (!result.ok || result.plusItems.length === 0 || result.minusItems.length === 0) return null;
  const checked = verifyCollision(params, result.plusItems, result.minusItems);
  const sides = [
    { label: 'set S', names: result.plusNames, items: result.plusItems },
    { label: 'set T', names: result.minusNames, items: result.minusItems },
  ].map((side) => {
    const state = new LtHash(params, 'set');
    for (const name of side.names) state.add(name);
    const incremental = state.digest;
    const scratch = digestOf(params, side.items);
    const probe = 'round-trip-probe';
    const after = new LtHash(params, 'set');
    for (const name of side.names) after.add(name);
    after.add(probe);
    after.remove(probe);
    return {
      label: side.label,
      names: side.names,
      incremental,
      scratch,
      roundTrip: after.digest,
      consistent: wordsEqual(incremental, scratch),
      roundTrips: wordsEqual(after.digest, incremental),
    };
  });
  return { params, result, checked, sides };
}

export function renderLimitPanel(root: HTMLElement): void {
  const params: LtHashParams = { N: 4, d: 4 };
  let fixture = buildFixture(params);
  const output = h('div', { class: 'output results', id: 'limit-results' });

  function drawOutput(): void {
    clear(output);
    if (!fixture) {
      output.append(
        verdict('limit-headline', 'fail', 'FIXTURE NOT BUILT — the two-bit run did not return two non-empty sets, so there is nothing to demonstrate'),
      );
      return;
    }
    const { sides, checked, result } = fixture;
    const everyCheckPasses = sides.every((s) => s.consistent && s.roundTrips);

    output.append(
      h(
        'div',
        { class: 'card-grid' },
        ...sides.map((side) =>
          h(
            'div',
            { class: 'card' },
            h('h3', {}, `${side.label} — ${side.names.length} item${side.names.length === 1 ? '' : 's'}`),
            field('items', side.names.slice(0, 6).join(', ') + (side.names.length > 6 ? `, … and ${side.names.length - 6} more` : '')),
            h('p', { class: 'field-label' }, 'digest, maintained by adding one item at a time'),
            wordCells(side.incremental, { label: `${side.label} incremental digest` }),
            side.consistent
              ? verdict(
                  side.label === 'set S' ? 'limit-consistent-s' : 'limit-consistent-t',
                  'pass',
                  `MATCH — the incremental digest equals Σ H(x) recomputed from scratch, in all ${params.N} words`,
                )
              : verdict(
                  side.label === 'set S' ? 'limit-consistent-s' : 'limit-consistent-t',
                  'fail',
                  `MISMATCH at word ${firstDifference(side.incremental, side.scratch)} between the incremental and recomputed digests`,
                ),
            side.roundTrips
              ? verdict(
                  side.label === 'set S' ? 'limit-roundtrip-s' : 'limit-roundtrip-t',
                  'pass',
                  'ROUND-TRIPPED — adding an extra item and removing it again returned every word to where it was',
                )
              : verdict(
                  side.label === 'set S' ? 'limit-roundtrip-s' : 'limit-roundtrip-t',
                  'fail',
                  'DID NOT ROUND-TRIP — removing the extra item left the digest changed',
                ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'And yet'),
        field('digest of set S', short(toHex(wordsToBytes(sides[0].incremental)), 20)),
        field('digest of set T', short(toHex(wordsToBytes(sides[1].incremental)), 20)),
        checked.ok && everyCheckPasses
          ? verdict(
              'limit-headline',
              'alarm',
              `DIGESTS MATCH — AND THE SETS DIFFER. Every check above reports success, and all ${params.N} words of the two digests are equal for two sets that share no item.`,
            )
          : verdict(
              'limit-headline',
              'fail',
              checked.ok
                ? 'FIXTURE INVALID — the collision holds but one of the correctness checks above failed, so this state demonstrates a broken update rather than a collision'
                : `FIXTURE INVALID — ${checked.reason}`,
            ),
        h('p', { class: 'callout callout-danger', 'data-negative-claim': 'true' }, NEGATIVE_CLAIM),
        h(
          'p',
          { class: 'help' },
          'There is no failure code for this. The construction compares digests and nothing else, so when two different sets produce the same digest every check it is able to perform still passes. The absence of an error is the finding, and a demo that invented one here would be teaching the opposite of the lesson.',
        ),
        statList(
          stat('limit-size-s', 'ITEMS IN SET S', String(sides[0].names.length), sides[0].names.length),
          stat('limit-size-t', 'ITEMS IN SET T', String(sides[1].names.length), sides[1].names.length),
          stat('limit-shared', 'ITEMS IN BOTH SETS', '0', 0),
          stat('limit-words-equal', 'WORDS THAT AGREE, OUT OF N', `${params.N} of ${params.N}`, params.N),
          stat('limit-queries', 'HASH QUERIES TO BUILD THE FIXTURE', result.queries.toLocaleString('en-US'), result.queries),
        ),
        h('div', { class: 'input-row' }, button('Build it again with fresh items', () => {
          fixture = buildFixture(params);
          drawOutput();
        }, { id: 'limit-rebuild' })),
      ),
    );
  }

  root.append(
    panelIntro(
      'Updates correct, sets different',
      'Everything this hash promises about updating is true here. That is the point.',
      'The two sets below were produced by the two-bit recursion. For each of them the page checks what a deployment would check: that the digest maintained by adding items one at a time equals the digest recomputed from scratch, and that adding an item and removing it again returns the digest exactly. Both checks pass, for both sets.',
      'The sets share no item, and their digests are identical in every word. Correct updating and collision resistance are different properties, and this instance has the first without the second.',
    ),
    reducedLabel(params.N, params.d),
    output,
    disclosure(
      'What this does and does not say about the deployed instance',
      h(
        'p',
        {},
        'It says nothing about it directly. This is a four-word, four-bit instance, and a collision here costs a few dozen hash queries. The deployed instance is N = 1024, d = 16, where the same algorithm would need the 49-digit number shown in exhibit 4 and the improved one reported about 2^81 queries.',
      ),
      h(
        'p',
        {},
        'What transfers is the shape of the failure: the modulus is a power of two in both, the attack peels its factors one or two at a time in both, and in both the construction has no way to notice. A deployment that compares two digests to decide whether two replicas hold the same data is relying on collision resistance, not on the update arithmetic it can see working.',
      ),
    ),
    learnerCheck(
      'A service compares LtHash digests to decide whether two replicas hold the same set. Which property is it relying on?',
      [
        { label: 'Collision resistance', correct: true },
        { label: 'Correct incremental updating', correct: false },
      ],
      'Collision resistance. Correct updating only guarantees that each replica’s digest really is the sum over the set it holds. Concluding that equal digests mean equal sets is exactly the step collision resistance licenses — and exactly the step this panel shows failing for a reduced instance.',
    ),
    note(
      'scope',
      'What this is not: evidence that the deployed instance has been broken. It is evidence that the two properties come apart, demonstrated at a size where the attack is cheap enough to run in a browser tab.',
    ),
  );
  drawOutput();
}
