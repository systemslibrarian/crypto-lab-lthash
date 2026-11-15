import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The RUNTIME denominator for the verdict rules.
 *
 * Every recorded kill in e2e/verdict-mutations.json names the test and the claim
 * that kills it, and §4.1c requires each of those to have been OBSERVED
 * executing. The obvious implementation — scanning verdicts.spec.ts for the
 * marker id — is defeated three ways, all of them mentions rather than
 * assertions: comment the call out and the substring survives inside the
 * comment; rewrite the killing assertion while an unrelated call elsewhere in
 * the file keeps the id present; keep the call but feed it values read off the
 * page in the same test.
 *
 * So the helpers record what they actually EXECUTED, and the rule is checked
 * against that record. Playwright runs tests in separate worker processes, so a
 * module-level Set aggregates nothing; the sink is a file, appended a line at a
 * time with O_APPEND (atomic at this size), truncated by globalSetup and read
 * back by globalTeardown.
 *
 * It lives under test-results/ but NOT under outputDir — Playwright wipes
 * outputDir when a run starts, which would race the truncation above.
 * playwright.config.ts points outputDir at test-results/artifacts for exactly
 * that reason.
 */
export const OBSERVATIONS_PATH = fileURLToPath(
  new URL('../test-results/verdict-observations.ndjson', import.meta.url),
);

/** Set by globalSetup, read by the helpers and by globalTeardown. */
export const RUN_ID_ENV = 'LTHASH_VERDICT_RUN_ID';

export interface Observation {
  run: string;
  test: string;
  kind: 'verdict' | 'claim';
  id: string;
  claim: string;
}

/**
 * One claim, in one canonical form, so a record in verdict-mutations.json and an
 * argument passed at runtime compare byte-for-byte. Keys are sorted; a RegExp
 * becomes its own literal source, which is what the registry stores.
 */
export function canonicalClaim(claim: Readonly<Record<string, unknown>>): string {
  const normalised: Record<string, unknown> = {};
  for (const key of Object.keys(claim).sort()) {
    const value = claim[key];
    if (value === undefined) continue;
    normalised[key] = value instanceof RegExp ? String(value) : value;
  }
  return JSON.stringify(normalised);
}

export function runId(): string {
  return process.env[RUN_ID_ENV] ?? '';
}

export function resetObservations(id: string): void {
  mkdirSync(dirname(OBSERVATIONS_PATH), { recursive: true });
  writeFileSync(OBSERVATIONS_PATH, '');
  process.env[RUN_ID_ENV] = id;
}

export function recordObservation(observation: Observation): void {
  mkdirSync(dirname(OBSERVATIONS_PATH), { recursive: true });
  appendFileSync(OBSERVATIONS_PATH, `${JSON.stringify(observation)}\n`);
}

/** Every observation this run wrote. Lines from any other run are discarded. */
export function readObservations(id: string): Observation[] {
  let raw = '';
  try {
    raw = readFileSync(OBSERVATIONS_PATH, 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Observation)
    .filter((observation) => observation.run === id);
}
