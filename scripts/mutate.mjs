#!/usr/bin/env node
// Applies, reverts, or JUDGES the recorded mutations in e2e/verdict-mutations.json.
//
//   node scripts/mutate.mjs list
//   node scripts/mutate.mjs apply <id>
//   node scripts/mutate.mjs revert <id>
//   node scripts/mutate.mjs run [id...]      <- the judging loop
//
// WHY A JUDGING LOOP AND NOT JUST apply/revert
//
// apply/revert leaves the judgement to a person, and the judgement is the part
// that goes wrong. A mutated run can go red for reasons that are not the finding:
// a build error, a server that never started, a port answering from an unmutated
// checkout. Each of those looks exactly like a kill in a terminal and is not one.
// Worse, a patch whose anchor no longer matches applies nothing at all, the suite
// stays green, and "the mutation survived" is indistinguishable from "the harness
// does not bite".
//
// THE FOUR RULES A KILL HAS TO CLEAR, all enforced below:
//
//   1. the owning test PASSED unmutated, in this same run;
//   2. the patch actually CHANGED the file (anchor unique, bytes different);
//   3. the run served the MUTATED code - proved two ways, because one is not
//      enough: the built bundle's hash must move, and the failure must not match
//      a shape that means the code never ran at all;
//   4. the failure is the OWNING assertion, not the suite going red.
//
// A patch that does not compile is DOES NOT BUILD and is never a kill. Fix the
// patch and re-run.
//
// The run happens in an isolated `git archive HEAD` tree with node_modules
// symlinked, so nothing is judged against the working copy and a crash cannot
// strand an inverted condition in a file that also holds real work. CI=1 forces
// playwright.config.ts's `reuseExistingServer: !process.env.CI` to false, so the
// port cannot be answered by a server an earlier, unmutated run left up.
//
// e2e/verdict-coverage.spec.ts is deliberately NOT part of a mutated run: its
// registry check asserts that each `find` string still occurs exactly once, which
// is false by construction while a patch is applied. It runs in the baseline,
// where that assertion means something.

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const registry = JSON.parse(readFileSync(join(root, 'e2e', 'verdict-mutations.json'), 'utf8'));
const [command, ...rest] = process.argv.slice(2);

const owners = (entry) => [
  ...Object.entries(entry.kills ?? {}).map(([marker, k]) => ({ kind: 'marker', name: marker, test: k.test })),
  ...(entry.specKills ?? []).map((t) => ({ kind: 'browser test', name: t, test: t })),
  ...(entry.unitKills ?? []).map((t) => ({ kind: 'unit test', name: t, test: t })),
];

if (command === 'list' || !command) {
  for (const [id, entry] of Object.entries(registry.mutations)) {
    console.log(`${id}\n  ${entry.file}`);
    for (const o of owners(entry)) console.log(`  kills ${o.kind}: ${o.name}`);
    console.log(`  ${entry.why}\n`);
  }
  process.exit(0);
}

/* ---- apply / revert: one edit, in the working tree ----------------------- */
if (command === 'apply' || command === 'revert') {
  const id = rest[0];
  const entry = registry.mutations[id];
  if (!entry) {
    console.error(`unknown mutation: ${id}`);
    process.exit(2);
  }
  const path = join(root, entry.file);
  const source = readFileSync(path, 'utf8');
  const [from, to] = command === 'apply' ? [entry.find, entry.replace] : [entry.replace, entry.find];
  const occurrences = source.split(from).length - 1;
  if (occurrences !== 1) {
    console.error(`refusing: ${entry.file} matched ${occurrences}x, want exactly 1`);
    process.exit(2);
  }
  writeFileSync(path, source.replace(from, to));
  console.log(`${command} ${id} -> ${entry.file}`);
  process.exit(0);
}

if (command !== 'run') {
  console.error(`unknown command: ${command}. Try list, apply, revert or run.`);
  process.exit(2);
}

/* ---- run: the judging loop ---------------------------------------------- */

const ids = rest.length ? rest : Object.keys(registry.mutations);
const unknown = ids.filter((id) => !registry.mutations[id]);
if (unknown.length) {
  console.error(`unknown mutation(s): ${unknown.join(', ')}`);
  process.exit(2);
}

const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();

// `git archive HEAD` cannot see uncommitted work, so a dirty tree would produce
// results about a tree nobody has.
const dirty = git('status', '--porcelain', '--untracked-files=no');
if (dirty && !process.env.MUTATION_ALLOW_DIRTY) {
  console.error('Refusing to run: uncommitted changes to tracked files.\n');
  console.error(dirty);
  console.error('\nThe isolated tree is archived from HEAD and would not contain them.');
  console.error('Commit first. MUTATION_ALLOW_DIRTY=1 overrides, knowing that.');
  process.exit(2);
}
const sha = git('rev-parse', 'HEAD').slice(0, 7);

/* Rule 2, checked for every selected patch BEFORE any is applied. An
   unreversible patch strands a mutated file and turns every later result into a
   verdict about that file rather than about its own mutation. */
const invalid = [];
for (const id of ids) {
  const entry = registry.mutations[id];
  const text = readFileSync(join(root, entry.file), 'utf8');
  const anchors = text.split(entry.find).length - 1;
  if (anchors !== 1) {
    invalid.push(`${id}: find occurs ${anchors} times in ${entry.file}, expected 1`);
    continue;
  }
  const after = text.replace(entry.find, entry.replace);
  if (after === text) invalid.push(`${id}: the patch is a no-op, it would not change ${entry.file}`);
  else if (after.split(entry.replace).length - 1 !== 1) {
    invalid.push(`${id}: replace occurs more than once after applying, so it cannot be reverted`);
  }
  if (owners(entry).length === 0) invalid.push(`${id}: records no owner, so it covers nothing`);
}
if (invalid.length) {
  console.error('Refusing to run: these patches cannot make the round trip.\n');
  for (const line of invalid) console.error(`  ${line}`);
  process.exit(2);
}

const TREE = mkdtempSync(join(tmpdir(), 'lthash-mutation-'));
console.log(`isolated tree: ${TREE}`);
console.log(`archived from: ${sha}`);
console.log(`${ids.length} patches make the round trip.\n`);
execSync(`git -C ${root} archive HEAD | tar -x -C ${TREE}`, { stdio: 'pipe' });
symlinkSync(join(root, 'node_modules'), join(TREE, 'node_modules'));

const sh = (cmd) =>
  execSync(cmd, {
    cwd: TREE,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    maxBuffer: 128 * 1024 * 1024,
  });

const DIST = join(TREE, 'dist', 'assets');
function bundleHash() {
  if (!existsSync(DIST)) return null;
  const h = createHash('sha256');
  for (const f of readdirSync(DIST).sort()) h.update(f).update(readFileSync(join(DIST, f)));
  return h.digest('hex').slice(0, 12);
}
const md5 = (rel) => createHash('md5').update(readFileSync(join(TREE, rel))).digest('hex').slice(0, 12);

function build() {
  try {
    sh('npm run build');
    return true;
  } catch {
    return false;
  }
}

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const strip = (s) => String(s).replace(ANSI, '');

/** Rule 3's second half. Red for one of these reasons means the code never ran. */
const NOT_A_KILL = [
  { pattern: /error TS\d+|Build failed|Transform failed|Could not resolve/i, label: 'build error' },
  { pattern: /webServer.*did not start|Timeout .* exceeded while running "beforeAll"/i, label: 'server never started' },
  { pattern: /ERR_CONNECTION_REFUSED/i, label: 'nothing served on the port' },
];
const notAKill = (output) => NOT_A_KILL.find(({ pattern }) => pattern.test(strip(output)))?.label ?? null;

function runUnit() {
  try {
    return { failed: false, output: sh('npx vitest run --reporter=verbose') };
  } catch (err) {
    return { failed: true, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function runBrowser() {
  const cmd = 'npx playwright test e2e/verdicts.spec.ts e2e/claims.spec.ts --reporter=list --retries=0';
  try {
    return { failed: false, output: sh(cmd) };
  } catch (err) {
    return { failed: true, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** Test titles the runners reported as failing. */
function failingTitles(output) {
  const text = strip(output);
  const titles = [];
  // Playwright's list reporter: "  1) e2e/x.spec.ts:12:1 > project > title"
  for (const m of text.matchAll(/^\s*\d+\)\s+(.+?)\s*$/gm)) titles.push(m[1].trim());
  // Vitest's verbose reporter marks a failing test with a multiplication sign.
  for (const m of text.matchAll(/^\s*[×x]\s+(.+?)(?:\s+\d+ms)?\s*$/gm)) titles.push(m[1].trim());
  for (const m of text.matchAll(/^\s*FAIL\s+(.+?)\s*$/gm)) titles.push(m[1].trim());
  return titles;
}

function apply(entry, forward) {
  const [from, to] = forward ? [entry.find, entry.replace] : [entry.replace, entry.find];
  const path = join(TREE, entry.file);
  const before = readFileSync(path, 'utf8');
  if (before.split(from).length - 1 !== 1) throw new Error(`${entry.file}: anchor no longer unique`);
  const after = before.replace(from, to);
  if (after === before) throw new Error('the patch produced an identical file: it did not apply');
  writeFileSync(path, after);
}

console.log('building the baseline in the isolated tree...');
if (!build()) {
  console.error('The baseline build fails in the isolated tree. Nothing below would mean anything.');
  rmSync(TREE, { recursive: true, force: true });
  process.exit(2);
}
const baselineHash = bundleHash();
console.log(`baseline bundle ${baselineHash}\n`);

console.log('running the unmutated baseline suites...');
const baseUnit = runUnit();
const baseBrowser = runBrowser();
if (baseUnit.failed || baseBrowser.failed) {
  console.error('The unmutated suites do not pass in the isolated tree. Nothing below would mean');
  console.error('anything: a mutation "caught" by an already-red suite is caught by nothing.\n');
  console.error(strip(baseUnit.failed ? baseUnit.output : baseBrowser.output).split('\n').slice(-30).join('\n'));
  rmSync(TREE, { recursive: true, force: true });
  process.exit(2);
}
const unitCount = (strip(baseUnit.output).match(/Tests\s+(\d+) passed/) || [])[1] ?? '?';
const browserCount = (strip(baseBrowser.output).match(/(\d+) passed/) || [])[1] ?? '?';
console.log(`baseline PASSED: ${unitCount} unit tests, ${browserCount} browser tests\n`);

const results = [];
for (const id of ids) {
  const entry = registry.mutations[id];
  const expected = owners(entry);
  process.stdout.write(`${id.padEnd(42)} `);
  try {
    const beforeMd5 = md5(entry.file);
    apply(entry, true);
    const built = build();
    const mutatedHash = built ? bundleHash() : null;
    const unit = built ? runUnit() : { failed: false, output: '' };
    const needsBrowser = expected.some((o) => o.kind !== 'unit test');
    const browser = built && needsBrowser ? runBrowser() : { failed: false, output: '' };
    const failed = [...failingTitles(unit.output), ...failingTitles(browser.output)];
    const survived = expected.filter((o) => !failed.some((t) => t.includes(o.test)));

    apply(entry, false);
    build();
    const restoredHash = bundleHash();
    if (md5(entry.file) !== beforeMd5) {
      console.log('NOT RESTORED');
      console.error(`\n${id}: ${entry.file} did not return to md5 ${beforeMd5}. Aborting.`);
      rmSync(TREE, { recursive: true, force: true });
      process.exit(2);
    }

    const shape = notAKill(unit.output) ?? notAKill(browser.output);
    const verdict = !built
      ? 'DOES NOT BUILD'
      : mutatedHash === baselineHash
        ? 'BUNDLE UNCHANGED'
        : shape
          ? `NOT A KILL (${shape})`
          : survived.length
            ? `SURVIVED (${survived.map((o) => o.name).join(', ')})`
            : restoredHash !== baselineHash
              ? 'NOT RESTORED'
              : 'KILLED';
    results.push({ id, verdict, owners: expected });
    console.log(
      verdict === 'KILLED'
        ? `KILLED  ${baselineHash} -> ${mutatedHash} -> ${restoredHash}  owners: ${expected.map((o) => o.name).join(' | ')}`
        : verdict,
    );
  } catch (err) {
    console.log(`ERROR  ${err.message}`);
    console.error('\nAborting: a mutated file left in place makes every later verdict a statement about it.');
    rmSync(TREE, { recursive: true, force: true });
    process.exit(2);
  }
}

rmSync(TREE, { recursive: true, force: true });
const bad = results.filter((r) => r.verdict !== 'KILLED');
const covered = results.reduce((n, r) => n + r.owners.length, 0);
console.log(`\n${results.length - bad.length}/${results.length} mutations killed, covering ${covered} owning assertions.`);
if (bad.length) {
  console.log('\nNot killed:');
  for (const r of bad) console.log(`  ${r.id}: ${r.verdict}`);
  console.log('\nDOES NOT BUILD is a broken PATCH, not a surviving mutation: fix the patch and re-run.');
  console.log('SURVIVED is evidence about the SOURCE or the test, and is the one worth stopping for.');
}
process.exit(bad.length ? 1 : 0);
