/**
 * Exhibit 2 — The real one.
 *
 * The deployed instance: N = 1024, d = 16, BLAKE2Xb expansion, run in the
 * browser and checked against the reference checksum from the Folly test suite.
 * The checksum is reproduced by the four-step sequence from that test, and the
 * page also shows the removal really was undone, by adding only the two items
 * that remain. The SHA-256 of the 2,048 digest bytes is computed here with
 * WebCrypto — a different implementation from everything else on the page — and
 * compared with the value recorded in the fixture.
 */
import { FOLLY_COMMIT, FOLLY_VECTOR_HEX, FOLLY_VECTOR_SHA256, FOLLY_VECTOR_STEPS } from '../lthash/folly-vector';
import {
  DEPLOYED,
  LtHash,
  bytesToWords,
  digestOf,
  firstDifference,
  fromHex,
  toHex,
  utf8,
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
  short,
  stat,
  statList,
  tableRegion,
  verdict,
  wordCells,
} from './dom';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return toHex(new Uint8Array(digest));
}

/** A random sequence of adds and removes, for the incremental-vs-scratch check. */
function randomSequence(): { op: 'add' | 'remove'; name: string }[] {
  const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  const out: { op: 'add' | 'remove'; name: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const name = names[Math.floor(Math.random() * names.length)];
    out.push({ op: Math.random() < 0.65 ? 'add' : 'remove', name });
  }
  return out;
}

export function renderDeployedPanel(root: HTMLElement): void {
  const output = h('div', { class: 'output results', id: 'deployed-results' });
  const pasteOutput = h('div', { id: 'deployed-paste-out' });
  let sequence = randomSequence();

  const drawOutput = (): void => {
    clear(output);

    // ── The reference sequence, step by step ────────────────────────────
    const hash = new LtHash(DEPLOYED, 'multiset');
    const rows: HTMLElement[] = [];
    for (const [i, step] of FOLLY_VECTOR_STEPS.entries()) {
      if (step.op === 'add') hash.add(step.item);
      else hash.remove(step.item);
      const digest = hash.digest;
      rows.push(
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, String(i + 1)),
          h('td', {}, step.op),
          h('td', {}, `"${step.item}"`),
          h('td', {}, [...digest.slice(0, 4)].join(' · ')),
          h('td', {}, short(toHex(wordsToBytes(digest)), 10)),
        ),
      );
    }
    const finalHex = toHex(wordsToBytes(hash.digest));
    const matches = finalHex === FOLLY_VECTOR_HEX;

    const table = h(
      'table',
      { class: 'grid-table' },
      h('caption', {}, 'The four steps of the Folly test addObjectWithKnownValue, as this page runs them'),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, '#'),
          h('th', { scope: 'col' }, 'operation'),
          h('th', { scope: 'col' }, 'item'),
          h('th', { scope: 'col' }, 'first four words'),
          h('th', { scope: 'col' }, 'digest'),
        ),
      ),
      h('tbody', {}, ...rows),
    );

    const digestField = h('textarea', {
      id: 'deployed-digest',
      class: 'mono-input',
      readonly: true,
      rows: '4',
      'aria-label': 'the full 2,048-byte digest as hex, selectable and copyable',
    }) as HTMLTextAreaElement;
    digestField.value = finalHex;

    output.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Add "a", add "b", add "hello", remove "b"'),
        tableRegion('The reference sequence step by step', table),
        h('p', { class: 'field-label' }, 'first sixteen words of the final digest'),
        wordCells(hash.digest, { limit: 16, label: 'first sixteen words of the deployed digest' }),
        h('label', { for: 'deployed-digest', class: 'field-label' }, 'the whole digest (2,048 bytes, 4,096 hex characters)'),
        digestField,
        matches
          ? verdict(
              'folly-vector',
              'pass',
              `MATCHES THE REFERENCE — all 1,024 words equal the checksum printed in the Folly test at commit ${FOLLY_COMMIT.slice(0, 12)}`,
            )
          : verdict(
              'folly-vector',
              'fail',
              `DIFFERS FROM THE REFERENCE at word ${firstDifference(hash.digest, bytesToWords(DEPLOYED, fromHex(FOLLY_VECTOR_HEX)))}`,
            ),
      ),
    );

    // ── The removal really was undone ───────────────────────────────────
    const withoutB = digestOf(DEPLOYED, [utf8('a'), utf8('hello')]);
    const sameAsReference = toHex(wordsToBytes(withoutB)) === FOLLY_VECTOR_HEX;
    output.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'The same digest from only "a" and "hello"'),
        h(
          'p',
          { class: 'help' },
          'If subtracting "b" really undid adding it, then hashing the two items that remain must give the same 2,048 bytes. It is computed here from scratch, with no removal involved.',
        ),
        field('Σ H(x) over {"a", "hello"}', short(toHex(wordsToBytes(withoutB)), 32)),
        sameAsReference
          ? verdict('folly-removal-undone', 'pass', 'IDENTICAL — adding and then removing "b" left no trace in any of the 1,024 words')
          : verdict('folly-removal-undone', 'fail', 'DIFFERENT — removing "b" did not undo adding it'),
      ),
    );

    // ── SHA-256 of the digest bytes, by an independent implementation ───
    const shaVerdict = verdict('folly-sha256', 'pending', 'Hashing the 2,048 digest bytes with WebCrypto…');
    const shaStats = h('div', {});
    output.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'A second opinion on the same bytes'),
        h(
          'p',
          { class: 'help' },
          'The browser’s own SHA-256 is applied to the 2,048 bytes this page produced, and compared with the SHA-256 recorded alongside the fixture. Nothing in that comparison runs through the BLAKE2 code above.',
        ),
        shaStats,
        shaVerdict,
      ),
    );
    void sha256Hex(fromHex(finalHex)).then((computed) => {
      clear(shaStats);
      shaStats.append(
        statList(
          stat('sha256-computed', 'SHA-256 OF THE BYTES ON THIS PAGE', short(computed, 16), computed),
          stat('sha256-recorded', 'SHA-256 RECORDED WITH THE FIXTURE', short(FOLLY_VECTOR_SHA256, 16), FOLLY_VECTOR_SHA256),
        ),
      );
      const ok = computed === FOLLY_VECTOR_SHA256;
      shaVerdict.setAttribute('data-result', ok ? 'pass' : 'fail');
      shaVerdict.className = `verdict verdict-${ok ? 'pass' : 'fail'}`;
      clear(shaVerdict);
      shaVerdict.append(
        h('span', { class: 'verdict-icon', 'aria-hidden': 'true' }, ok ? '✓' : '✕'),
        h(
          'span',
          {},
          ok
            ? 'SAME 32 BYTES — WebCrypto agrees with the recorded hash of the reference checksum'
            : 'DIFFERENT — WebCrypto disagrees with the recorded hash of the reference checksum',
        ),
      );
    });

    // ── Incremental against a full recomputation ────────────────────────
    const roller = new LtHash(DEPLOYED, 'multiset');
    for (const step of sequence) {
      if (step.op === 'add') roller.add(step.name);
      else roller.remove(step.name);
    }
    const scratch = roller.recomputeFromScratch();
    const diff = firstDifference(roller.digest, scratch);
    output.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Twelve random updates, then a full recomputation'),
        h(
          'p',
          { class: 'help' },
          'A random run of adds and removes is applied one at a time, then the digest is rebuilt from the net counts and the two are compared across all 1,024 words.',
        ),
        field(
          'the sequence',
          sequence.map((s) => `${s.op === 'add' ? '+' : '−'}${s.name}`).join('  '),
          { mono: false },
        ),
        diff === -1
          ? verdict('deployed-incremental', 'pass', 'MATCH — the incrementally maintained digest equals the recomputed one in all 1,024 words')
          : verdict('deployed-incremental', 'fail', `MISMATCH at word ${diff} between the incremental and recomputed digests`),
        h('div', { class: 'input-row' }, button('Run another random sequence', () => {
          sequence = randomSequence();
          drawOutput();
        }, { id: 'deployed-reroll' })),
      ),
    );

    output.append(
      statList(
        stat('deployed-words', 'WORDS', '1,024', 1024),
        stat('deployed-bits', 'BITS PER WORD', '16', 16),
        stat('deployed-bytes', 'DIGEST BYTES', '2,048', 2048),
        stat('deployed-blocks', 'BLAKE2Xb OUTPUT BLOCKS PER ITEM', '32', 32),
        stat('deployed-queries', 'HASH QUERIES THIS PANEL MADE', (hash.queries + roller.queries * 2).toLocaleString('en-US'), hash.queries + roller.queries * 2),
      ),
    );
  };

  const checkPaste = (value: string): void => {
    clear(pasteOutput);
    const text = value.trim();
    try {
      const bytes = fromHex(text);
      const words = bytesToWords(DEPLOYED, bytes);
      const zeros = [...words].filter((w) => w === 0).length;
      pasteOutput.append(
        verdict(
          'digest-parse',
          'pass',
          `ACCEPTED — 2,048 bytes, 1,024 words, ${zeros} of them zero`,
        ),
      );
    } catch (err) {
      pasteOutput.append(
        verdict('digest-parse', 'fail', `REFUSED — ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  };

  const pasteInput = h('textarea', {
    id: 'deployed-paste',
    class: 'mono-input',
    rows: '3',
    'aria-describedby': 'deployed-paste-help',
  }) as HTMLTextAreaElement;
  pasteInput.value = FOLLY_VECTOR_HEX.slice(0, 4094);

  root.append(
    panelIntro(
      'The real one',
      'This is the instance that is actually deployed, running in your browser at full size.',
      'N = 1024 words of d = 16 bits each: a 2,048-byte digest, with each item expanded by BLAKE2Xb into 1,024 little-endian 16-bit words and added in word by word. It is the parameter set the Folly library ships, the one Facebook deployed for configuration updates, and the one Solana uses for account state.',
      'The checksum below is not something this page asserts. It is the value printed in Folly’s own test file, and the page reproduces it from the same four operations, then has the browser’s SHA-256 agree about the bytes.',
    ),
    note(
      'info',
      'The reference vector is copied from ',
      h('a', { href: 'https://github.com/facebook/folly/blob/main/folly/crypto/test/LtHashTest.cpp', target: '_blank', rel: 'noopener noreferrer' }, 'folly/crypto/test/LtHashTest.cpp'),
      ` at commit `,
      h('code', {}, FOLLY_COMMIT.slice(0, 12)),
      '. Folly is Apache-2.0 licensed; the notice travels with the fixture in the source.',
    ),
    output,
    h(
      'div',
      { class: 'controls' },
      h(
        'div',
        { class: 'control' },
        h('label', { for: 'deployed-paste' }, 'Paste a digest to check its shape'),
        pasteInput,
        h(
          'p',
          { class: 'help', id: 'deployed-paste-help' },
          'A digest for this instance is exactly 2,048 bytes. The field starts one character short of that, so pressing the button shows what a wrong length does.',
        ),
        h('div', { class: 'input-row' }, button('Check this digest', () => checkPaste(pasteInput.value), { kind: 'primary', id: 'deployed-check' })),
        pasteOutput,
      ),
    ),
    disclosure(
      'The BLAKE2Xb parameterisation that reproduces this vector',
      h(
        'p',
        {},
        'The root hash is BLAKE2b with digest length 64, fanout 1, depth 1, and the four-byte XOF-length field set to 2,048. Output block i is BLAKE2b of that root hash with digest length min(64, bytes still needed), fanout 0, depth 0, leaf length 64, node offset i, the same XOF length, node depth 0 and inner length 64.',
      ),
      h(
        'p',
        {},
        'The node offset is the field that makes block i differ from block 0. Thirty-two blocks go into one 2,048-byte expansion, so this vector exercises the multi-block path 32 times for every item.',
      ),
      h(
        'p',
        {},
        'BLAKE2b itself is hand-rolled here: the browser has no BLAKE2, and the usual library APIs hide the parameter block that the extendable-output mode is built out of. It is checked against the RFC 7693 vector and cross-checked against two other implementations in the test suite.',
      ),
    ),
    learnerCheck(
      'A 2,048-byte digest is 16,384 bits. Does that mean collisions need about 2^8,192 work?',
      [
        { label: 'No — the structure matters, not the length', correct: true },
        { label: 'Yes, the digest length sets the bar', correct: false },
      ],
      'No. A birthday bound would say 2^8,192, but this digest is a sum in a group with structure an attacker can use, so the real cost is set by the hardness of finding a short relation. The published estimate for this instance was at least 200 bits; the 2026 attack in the last two exhibits reports about 2^81 hash queries. Digest length is an upper bound on security, never a measurement of it.',
    ),
    note(
      'scope',
      'What this is not: a break of this instance. Nothing on this page produces a collision for N = 1024, d = 16, and the attack exhibits run at reduced sizes only.',
    ),
  );
  drawOutput();
}
