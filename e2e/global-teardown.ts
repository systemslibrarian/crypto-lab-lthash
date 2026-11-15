import { readFileSync } from 'node:fs';
import { canonicalClaim, readObservations, runId } from './observations.js';

interface KillRecord {
  test: string;
  claim: Record<string, unknown>;
}

interface MutationEntry {
  file: string;
  find: string;
  replace: string;
  why: string;
  /** Browser markers this mutation kills, with the test and claim that kill them. */
  kills?: Record<string, KillRecord>;
  /** Vitest test titles this mutation kills. Enforced by scripts/mutate.mjs, not here. */
  unitKills?: string[];
}

/** Separator for composite keys: never appears in a test title or a claim. */
const SEP = ' >>> ';

/**
 * The runtime half of the mutation-record rule (§4.1c).
 *
 * Every entry in e2e/verdict-mutations.json that names a browser marker also
 * names the TEST and the exact CLAIM that kills it. This asks whether that
 * assertion actually RAN, and the answer is read from what expectVerdict /
 * expectClaim executed — never from the spec's source text, because a mention is
 * not an assertion. The three ways a source scan is defeated are all mentions:
 * the call commented out; the killing assertion rewritten while an unrelated
 * call elsewhere keeps the id present; the call kept but fed values read off the
 * page in the same test, which is byte-identical to a correct assertion on an
 * unmutated baseline. Pinning the CLAIM as well as the (test, marker) pair is
 * what closes the last one: under the mutation a tautological argument moves
 * with the page and stops matching what was recorded.
 *
 * It runs as a global teardown rather than in a project with `dependencies:`
 * deliberately: a dependent project is SKIPPED when the project it needs fails,
 * which is exactly the run — a mutation applied — where this answer matters most.
 */
export default function globalTeardown(): void {
  const id = runId();
  if (!id) {
    throw new Error(
      'verdict runtime coverage: no run id. e2e/global-setup.ts did not run, so the ' +
        'observation sink was never truncated and nothing it holds can be trusted.',
    );
  }

  const registry = JSON.parse(
    readFileSync(new URL('./verdict-mutations.json', import.meta.url), 'utf8'),
  ) as { mutations: Record<string, MutationEntry> };

  const observed = readObservations(id);
  const recorded = Object.values(registry.mutations).flatMap((entry) => Object.entries(entry.kills ?? {}));
  if (recorded.length === 0) return;

  if (observed.length === 0) {
    throw new Error(
      'verdict runtime coverage: this run executed no expectVerdict/expectClaim call.\n' +
        'The rule is checked against what ran, so a run that leaves out e2e/verdicts.spec.ts and\n' +
        'e2e/claims.spec.ts cannot answer it. Run the whole suite rather than a narrowed selection.',
    );
  }

  const seenTriples = new Set(observed.map((o) => `${o.test}${SEP}${o.id}${SEP}${o.claim}`));
  const seenPairs = new Set(observed.map((o) => `${o.test}${SEP}${o.id}`));
  const seenIds = new Set(observed.map((o) => o.id));

  const failures: string[] = [];
  for (const [mutation, entry] of Object.entries(registry.mutations)) {
    for (const [marker, kill] of Object.entries(entry.kills ?? {})) {
      const claim = canonicalClaim(kill.claim);
      if (seenTriples.has(`${kill.test}${SEP}${marker}${SEP}${claim}`)) continue;
      if (seenPairs.has(`${kill.test}${SEP}${marker}`)) {
        failures.push(
          `${mutation} -> ${marker}: "${kill.test}" asserted this marker, but never with the ` +
            `recorded killing claim ${claim}`,
        );
      } else if (seenIds.has(marker)) {
        failures.push(
          `${mutation} -> ${marker}: no expectVerdict/expectClaim for this marker executed in ` +
            `"${kill.test}" — the id is asserted elsewhere in the run, which is not the assertion ` +
            'this record names',
        );
      } else {
        failures.push(`${mutation} -> ${marker}: no expectVerdict/expectClaim for this marker executed at all`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `verdict runtime coverage: ${failures.length} recorded kill(s) never ran.\n` +
        'Every mutation in e2e/verdict-mutations.json names the test and the claim that kills it,\n' +
        'and each of those had to be OBSERVED executing in this run.\n\n' +
        failures.map((line) => `  - ${line}`).join('\n'),
    );
  }

  console.log(
    `verdict runtime coverage: ${recorded.length} recorded kills, every one observed executing ` +
      `(${observed.length} helper assertions this run)`,
  );
}
