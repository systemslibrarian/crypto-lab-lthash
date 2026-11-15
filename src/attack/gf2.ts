/**
 * Linear algebra over the two-element field, the only algebra the bit-cancelling
 * recursions need: a reduced row echelon form by Gaussian elimination with an
 * explicit row swap, a kernel vector, a solver with free variables set to zero
 * (the paper's Solve2), and a rank.
 *
 * Matrices are arrays of rows; every entry is 0 or 1. The elimination records
 * its steps on request so exhibit 3 can replay them as a real table of 0s and 1s.
 */

export interface EliminationStep {
  kind: 'swap' | 'pivot' | 'xor';
  /** The row acted on (for xor: the row being cleared). */
  row: number;
  /** The pivot column (pivot and xor steps). */
  col?: number;
  /** The other row (swap: the row swapped in; xor: the pivot row added). */
  other?: number;
}

export interface Rref {
  rows: Uint8Array[];
  pivotCols: number[];
  rank: number;
  steps: EliminationStep[];
}

/** Rows from a list of column vectors (each of length n). */
export function fromColumns(columns: readonly Uint8Array[], n: number): Uint8Array[] {
  const rows: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const row = new Uint8Array(columns.length);
    for (let j = 0; j < columns.length; j++) row[j] = columns[j][i] & 1;
    rows.push(row);
  }
  return rows;
}

/** The low bit of every word: a vector over the two-element field. */
export function parity(words: Uint32Array): Uint8Array {
  const out = new Uint8Array(words.length);
  for (let i = 0; i < words.length; i++) out[i] = words[i] & 1;
  return out;
}

/**
 * Reduced row echelon form with a deterministic pivoting rule: for each column
 * in order, the FIRST remaining row with a 1 becomes the pivot row and is
 * swapped up into position. The swap is load-bearing — the pivot bookkeeping
 * below assumes the pivot for column c sits in row r — which is why mutation (6)
 * of this lab's ledger targets it.
 */
export function rref(matrix: readonly Uint8Array[], record = false): Rref {
  const A = matrix.map((r) => Uint8Array.from(r));
  const n = A.length;
  const m = n ? A[0].length : 0;
  const pivotCols: number[] = [];
  const steps: EliminationStep[] = [];
  let r = 0;
  for (let c = 0; c < m && r < n; c++) {
    let p = r;
    while (p < n && A[p][c] === 0) p++;
    if (p === n) continue; // no pivot in this column: a free column
    if (p !== r) {
      const tmp = A[p];
      A[p] = A[r];
      A[r] = tmp;
      if (record) steps.push({ kind: 'swap', row: r, other: p });
    }
    if (record) steps.push({ kind: 'pivot', row: r, col: c });
    for (let i = 0; i < n; i++) {
      if (i !== r && A[i][c] === 1) {
        for (let j = 0; j < m; j++) A[i][j] ^= A[r][j];
        if (record) steps.push({ kind: 'xor', row: i, other: r, col: c });
      }
    }
    pivotCols.push(c);
    r++;
  }
  return { rows: A, pivotCols, rank: r, steps };
}

export function rank(matrix: readonly Uint8Array[]): number {
  return rref(matrix).rank;
}

/** A·x over the two-element field. */
export function multiply(matrix: readonly Uint8Array[], x: Uint8Array): Uint8Array {
  const out = new Uint8Array(matrix.length);
  for (let i = 0; i < matrix.length; i++) {
    let acc = 0;
    const row = matrix[i];
    for (let j = 0; j < row.length; j++) acc ^= row[j] & x[j];
    out[i] = acc;
  }
  return out;
}

export class NoKernelVectorError extends Error {
  constructor(rows: number, cols: number) {
    super(`the ${rows}×${cols} matrix has full column rank: no non-zero kernel vector exists`);
    this.name = 'NoKernelVectorError';
  }
}

/**
 * A non-zero vector x with A·x = 0, found by setting the first free variable to
 * one and the other free variables to zero (the paper's Kernel2). Any N + 1
 * columns of length N have one. The result is CHECKED against the original
 * matrix before it is returned: an elimination that went wrong fails closed
 * here rather than handing the recursion a vector it would then halve.
 */
export function kernelVector(matrix: readonly Uint8Array[], record = false): { vector: Uint8Array; rref: Rref } {
  const R = rref(matrix, record);
  const m = matrix.length ? matrix[0].length : 0;
  const isPivot = new Uint8Array(m);
  for (const c of R.pivotCols) isPivot[c] = 1;
  let free = -1;
  for (let c = 0; c < m; c++) {
    if (!isPivot[c]) {
      free = c;
      break;
    }
  }
  if (free < 0) throw new NoKernelVectorError(matrix.length, m);
  const x = new Uint8Array(m);
  x[free] = 1;
  for (let r = 0; r < R.rank; r++) x[R.pivotCols[r]] = R.rows[r][free];
  const check = multiply(matrix, x);
  if (check.some((v) => v !== 0)) {
    throw new Error('elimination produced a vector outside the kernel: A·x ≠ 0');
  }
  return { vector: x, rref: R };
}

/**
 * Solve A·x = b over the two-element field, or return null if the system is
 * inconsistent. Free variables are set to zero and pivots are chosen by the
 * same deterministic rule as `rref` (the paper's Solve2). A solution is checked
 * before it is returned.
 */
export function solve(matrix: readonly Uint8Array[], b: Uint8Array): Uint8Array | null {
  const n = matrix.length;
  const m = n ? matrix[0].length : 0;
  if (b.length !== n) throw new RangeError(`right-hand side has ${b.length} entries, the matrix has ${n} rows`);
  const augmented = matrix.map((row, i) => {
    const a = new Uint8Array(m + 1);
    a.set(row, 0);
    a[m] = b[i] & 1;
    return a;
  });
  const R = rref(augmented);
  // A pivot in the augmented column means a row 0 … 0 | 1: inconsistent.
  if (R.pivotCols.includes(m)) return null;
  const x = new Uint8Array(m);
  for (let r = 0; r < R.rank; r++) x[R.pivotCols[r]] = R.rows[r][m];
  const check = multiply(matrix, x);
  for (let i = 0; i < n; i++) {
    if (check[i] !== (b[i] & 1)) throw new Error('elimination produced a non-solution: A·x ≠ b');
  }
  return x;
}
