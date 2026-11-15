/**
 * Two-bit lifting: Ding, Gong, Jiang and Tang, "Two-Bit Lifting for Ternary
 * SIS: Polynomial-Time Collision Attacks on LtHash", IACR ePrint 2026/2083,
 * Section 3 (Lemma 1, Definition 2, Algorithm 1, Algorithm 2) and Section 4
 * (Lemma 3, Proposition 4, equations 8–16). Implemented from the paper, read in
 * full; the names below follow its notation.
 *
 * One layer turns a source of columns modulo 2^s into a source modulo 2^(s−2):
 *
 *   fill a basis B of N columns whose reductions mod 2 are independent;
 *   repeat: take a trial batch C of t fresh columns;
 *           x = B̄⁻¹ C̄ 1  — the unique basis subset X whose parities cancel the batch's;
 *           V = (B_X | C), u = V·1 (every word even);
 *           y = Solve2(V̄, u/2) — signs: V(1 − 2y) ≡ 0 (mod 4) iff V̄ y = u/2;
 *           if the sign system is inconsistent, drop the batch and try another
 *   until y exists;
 *   retain the unselected basis columns, η = 1 − 2y, output (V η)/4.
 *
 * Changing a sign preserves parity (−1 ≡ 1 mod 2), so the first cancellation
 * survives the sign choice, and disjoint base supports keep every composed
 * coefficient in {−1, 0, 1}. ⌊d/2⌋ layers remove d or d − 1 bits; for odd d a
 * last one-bit kernel step among N + 1 outputs modulo 2 finishes it.
 *
 * The guarantee is probabilistic (Theorem 2: at least 3/4 within a query cap),
 * so a run that reaches its cap is reported as a failure, never retried into a
 * success. Nothing here reports a collision either: the items go to
 * src/check/verify.ts like everything else.
 */
import { fromColumns, kernelVector, rank, solve } from './gf2';
import { baseItem, baseItemName, oneBitQueryCount, QUERY_CAP } from './onebit';
import { type HashOracle, type LtHashParams, checkParams } from '../lthash/lthash';

/** A column modulo 2^s with its signed representation over the base items. */
export interface TernaryColumn {
  words: Uint32Array;
  /** base item index → +1 or −1; supports of distinct columns are disjoint. */
  rep: Map<number, 1 | -1>;
}

export interface ColumnSource {
  readonly modulusBits: number;
  next(): TernaryColumn;
}

export class QueryBudgetExceeded extends Error {
  constructor(readonly cap: number) {
    super(`the two-bit run reached its query cap of ${cap.toLocaleString('en-US')} and was aborted, as the paper's capped execution does; this run is a failure`);
    this.name = 'QueryBudgetExceeded';
  }
}

/** G0: fresh base items, one hash query each. */
export class BaseSource implements ColumnSource {
  readonly modulusBits: number;
  requests = 0;
  constructor(private readonly params: LtHashParams, private readonly oracle: HashOracle, private readonly nextIndex: { value: number }, private readonly cap: number) {
    this.modulusBits = params.d;
  }
  next(): TernaryColumn {
    if (this.requests >= this.cap) throw new QueryBudgetExceeded(this.cap);
    const i = this.nextIndex.value++;
    this.requests += 1;
    const words = this.oracle.hash(baseItem(i));
    void this.params;
    return { words, rep: new Map([[i, 1]]) };
  }
}

export interface LayerStats {
  inputModulusBits: number;
  outputModulusBits: number;
  t: number;
  inputsConsumed: number;
  basisColumnsDropped: number;
  attempts: number;
  rejections: number;
  outputs: number;
}

const parityOf = (c: TernaryColumn): Uint8Array => {
  const out = new Uint8Array(c.words.length);
  for (let i = 0; i < out.length; i++) out[i] = c.words[i] & 1;
  return out;
};

/** Algorithm 1: TwoBitLayer_{s,t}(S). */
export class TwoBitLayer implements ColumnSource {
  readonly modulusBits: number;
  readonly stats: LayerStats;
  /** The retained tuple P: columns whose reductions mod 2 are independent. */
  private P: TernaryColumn[] = [];

  constructor(private readonly input: ColumnSource, private readonly N: number, private readonly t: number) {
    if (input.modulusBits < 2) throw new RangeError(`a two-bit layer needs at least 2 modulus bits, the input has ${input.modulusBits}`);
    if (!Number.isInteger(t) || t < 1) throw new RangeError(`batch size t must be a positive integer, got ${t}`);
    this.modulusBits = input.modulusBits - 2;
    this.stats = {
      inputModulusBits: input.modulusBits,
      outputModulusBits: this.modulusBits,
      t,
      inputsConsumed: 0,
      basisColumnsDropped: 0,
      attempts: 0,
      rejections: 0,
      outputs: 0,
    };
  }

  private pull(): TernaryColumn {
    this.stats.inputsConsumed += 1;
    return this.input.next();
  }

  next(): TernaryColumn {
    const { N, t } = this;
    const s = this.input.modulusBits;
    const modulus = 2 ** s;

    // ── Fill a basis modulo two ──────────────────────────────────────────
    while (this.P.length < N) {
      const a = this.pull();
      const candidate = [...this.P, a].map(parityOf);
      if (rank(fromColumns(candidate, N)) === candidate.length) this.P.push(a);
      else this.stats.basisColumnsDropped += 1; // drop(a)
    }
    const B = this.P;
    const Bbar = fromColumns(B.map(parityOf), N);

    // ── Try new batches against the basis ────────────────────────────────
    let V: TernaryColumn[] = [];
    let X: number[] = [];
    let y: Uint8Array | null = null;
    for (;;) {
      this.stats.attempts += 1;
      const C: TernaryColumn[] = [];
      for (let j = 0; j < t; j++) C.push(this.pull());
      // x = B̄⁻¹ C̄ 1_t: the unique basis subset whose parities cancel the batch's.
      const target = new Uint8Array(N);
      for (const c of C) for (let i = 0; i < N; i++) target[i] ^= c.words[i] & 1;
      const x = solve(Bbar, target);
      if (x === null) throw new Error('the basis is not invertible modulo two: the layer invariant is broken');
      X = [];
      for (let i = 0; i < N; i++) if (x[i]) X.push(i);
      V = [...X.map((i) => B[i]), ...C];
      // u = V·1: every word is even by construction (equation 2); checked, not assumed.
      const half = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        let u = 0;
        for (const v of V) u += v.words[i];
        u %= modulus;
        if (u % 2 !== 0) throw new Error(`word ${i} of u is odd: the parity cancellation failed`);
        half[i] = (u / 2) & 1;
      }
      // Cancel the second bit by choosing signs: V̄ y = u/2 (mod 2).
      y = solve(fromColumns(V.map(parityOf), N), half);
      if (y !== null) break;
      this.stats.rejections += 1; // drop(C), keep the basis, try a new batch
    }

    // ── Merge the accepted batch ─────────────────────────────────────────
    this.P = B.filter((_, i) => !X.includes(i));
    const eta = Array.from(y, (bit) => (bit ? -1 : 1) as 1 | -1);
    const words = new Uint32Array(N);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = 0; k < V.length; k++) acc += eta[k] * V[k].words[i];
      acc = ((acc % modulus) + modulus) % modulus;
      if (acc % 4 !== 0) throw new Error(`word ${i} of V·η is not divisible by 4: the sign step failed`);
      words[i] = acc / 4; // already below 2^(s−2)
    }
    const rep = new Map<number, 1 | -1>();
    for (let k = 0; k < V.length; k++) {
      for (const [index, sign] of V[k].rep) {
        if (rep.has(index)) throw new Error(`base item ${index} reached a merge through two inputs: supports are not disjoint`);
        rep.set(index, (eta[k] * sign) as 1 | -1);
      }
    }
    this.stats.outputs += 1;
    return { words, rep };
  }
}

export interface TwoBitResult {
  ok: boolean;
  reason: string;
  params: LtHashParams;
  t: number;
  /** Items with coefficient +1 and −1: the two colliding sets. */
  plusIndices: number[];
  minusIndices: number[];
  plusItems: Uint8Array[];
  minusItems: Uint8Array[];
  plusNames: string[];
  minusNames: string[];
  /** Hash queries this run made. */
  queries: number;
  /** The one-bit recursion's (N + 1)^d at the same size, for the comparison. */
  oneBitQueries: bigint;
  cap: number;
  layers: LayerStats[];
}

/** Algorithm 2 with batch size t at every layer. */
export function runTwoBit(params: LtHashParams, oracle: HashOracle, options: { t?: number; cap?: number } = {}): TwoBitResult {
  checkParams(params);
  const { N, d } = params;
  const t = options.t ?? N + 1;
  const oneBit = oneBitQueryCount(params);
  // Cap at the one-bit count or the page cap, whichever is smaller: a run that
  // needs more queries than the one-bit recursion has lost the comparison.
  const cap = options.cap ?? Number(oneBit < BigInt(QUERY_CAP) ? oneBit : BigInt(QUERY_CAP));
  const queriesAtStart = oracle.queries;
  const base = new BaseSource(params, oracle, { value: 0 }, cap);
  const layers: TwoBitLayer[] = [];
  let source: ColumnSource = base;
  const L2 = Math.floor(d / 2);
  for (let j = 1; j <= L2; j++) {
    const layer = new TwoBitLayer(source, N, t);
    layers.push(layer);
    source = layer;
  }
  const finish = (ok: boolean, reason: string, rep: Map<number, 1 | -1>): TwoBitResult => {
    const plus: number[] = [];
    const minus: number[] = [];
    for (const [i, sign] of rep) (sign === 1 ? plus : minus).push(i);
    plus.sort((a, b) => a - b);
    minus.sort((a, b) => a - b);
    return {
      ok,
      reason,
      params,
      t,
      plusIndices: plus,
      minusIndices: minus,
      plusItems: plus.map(baseItem),
      minusItems: minus.map(baseItem),
      plusNames: plus.map(baseItemName),
      minusNames: minus.map(baseItemName),
      queries: oracle.queries - queriesAtStart,
      oneBitQueries: oneBit,
      cap,
      layers: layers.map((l) => ({ ...l.stats })),
    };
  };
  try {
    let rep: Map<number, 1 | -1>;
    if (d % 2 === 0) {
      const w = source.next();
      if (source.modulusBits !== 0 || w.words.some((v) => v !== 0)) throw new Error('the terminal column is not zero modulo 2^0');
      rep = w.rep;
    } else {
      // Terminal one-bit step: a binary dependence among N + 1 outputs modulo 2.
      const outputs: TernaryColumn[] = [];
      for (let i = 0; i <= N; i++) outputs.push(source.next());
      if (source.modulusBits !== 1) throw new Error(`expected columns modulo 2 at the terminal step, got 2^${source.modulusBits}`);
      const { vector: lambda } = kernelVector(fromColumns(outputs.map(parityOf), N));
      rep = new Map();
      for (let i = 0; i <= N; i++) {
        if (!lambda[i]) continue;
        for (const [index, sign] of outputs[i].rep) {
          if (rep.has(index)) throw new Error(`base item ${index} appears in two terminal outputs`);
          rep.set(index, sign);
        }
      }
    }
    if (rep.size === 0) throw new Error('the relation is empty');
    return finish(true, `a ternary relation over ${rep.size} base items was found in ${(oracle.queries - queriesAtStart).toLocaleString('en-US')} hash queries`, rep);
  } catch (err) {
    if (err instanceof QueryBudgetExceeded) return finish(false, err.message, new Map());
    throw err;
  }
}

// ── The paper's expected-query formulas (Section 4), computed rather than quoted ──

/** Σ_{j=1..k} log2(j), so binomial coefficients can be formed in log space. */
function logFactorialTable(n: number): Float64Array {
  const t = new Float64Array(n + 1);
  for (let j = 1; j <= n; j++) t[j] = t[j - 1] + Math.log2(j);
  return t;
}

/** Prefix sums S_a(r) = Σ_{i<r} log2(1 − 2^(i−a)), for r = 0..a. */
function logProductTable(a: number): Float64Array {
  const t = new Float64Array(a + 1);
  for (let i = 0; i < a; i++) t[i + 1] = t[i] + Math.log2(1 - 2 ** (i - a));
  return t;
}

/**
 * γ(a, b) = Pr[h ∈ colspan(G)] = E[2^(rk G − a)] for uniform G ∈ F2^(a×b), h ∈ F2^a
 * (equation 7), from the rank distribution of a uniform binary matrix:
 *   Pr[rk = r] = 2^(r(a+b−r) − ab) Π_{i<r} (1 − 2^(i−a))(1 − 2^(i−b)) / (1 − 2^(i−r)).
 */
export function gamma(a: number, b: number, tables: Map<number, Float64Array> = new Map()): number {
  if (a === 0) return 1;
  if (b === 0) return 2 ** -a;
  const table = (n: number): Float64Array => {
    let t = tables.get(n);
    if (!t) {
      t = logProductTable(n);
      tables.set(n, t);
    }
    return t;
  };
  const Sa = table(a);
  const Sb = table(b);
  let total = 0;
  const rmax = Math.min(a, b);
  for (let r = 0; r <= rmax; r++) {
    const Sr = table(r);
    const logP = r * (a + b - r) - a * b + Sa[r] + Sb[r] - Sr[r];
    total += 2 ** (logP + r - a);
  }
  return total;
}

export interface LayerCost {
  N: number;
  t: number;
  /** One-attempt success probability p_{N,t} (equation 8). */
  p: number;
  /** Expected refill cost after an accepted output, R_{N,t} (equation 10). */
  R: number;
  /** r_N: expected inputs to fill a basis from empty (equation 9). */
  rN: number;
  /** Affine cost per output µ = t/p + R, and constant c = r_N − R (equation 13). */
  mu: number;
  c: number;
}

/** p_{N,t}, R_{N,t}, r_N, µ, c for one layer, from equations 8–13. */
export function layerCost(N: number, t: number): LayerCost {
  const logFact = logFactorialTable(N);
  const tables = new Map<number, Float64Array>();
  const r = new Float64Array(N + 1);
  for (let j = 1; j <= N; j++) r[j] = r[j - 1] + 1 / (1 - 2 ** -j);
  let p = 0;
  let Rnum = 0;
  for (let k = 0; k <= N; k++) {
    const weight = 2 ** (logFact[N] - logFact[k] - logFact[N - k] - N); // 2^−N · C(N, k)
    const g = gamma(N - k, t - 1, tables);
    p += weight * g;
    Rnum += weight * g * r[k];
  }
  const R = Rnum / p;
  return { N, t, p, R, rN: r[N], mu: t / p + R, c: r[N] - R };
}

export interface ExpectedQueries {
  N: number;
  d: number;
  t: number;
  layers: number;
  terminalOutputs: number;
  cost: LayerCost;
  /** Q_ℓ for ℓ = 0..L2 (equation 16); the last entry is E[Q]. */
  Q: number[];
  expected: number;
  log2Expected: number;
  /** The paper's capped budget ⌈4·E[Q]⌉ (Corollary 3), as log2. */
  log2Budget: number;
}

/** E[Q] for Algorithm 2 with a common batch size t (Proposition 5, equation 16). */
export function expectedTwoBitQueries(N: number, d: number, t: number): ExpectedQueries {
  const cost = layerCost(N, t);
  const L2 = Math.floor(d / 2);
  const m = d % 2 === 0 ? 1 : N + 1;
  const Q = [m];
  for (let l = 0; l < L2; l++) Q.push(cost.mu * Q[l] + cost.c);
  const expected = Q[L2];
  return {
    N,
    d,
    t,
    layers: L2,
    terminalOutputs: m,
    cost,
    Q,
    expected,
    log2Expected: Math.log2(expected),
    log2Budget: Math.log2(4 * expected),
  };
}
