# LtHash

**Homomorphic set hashing · ternary SIS · power-of-two collisions**

An interactive, browser-only lab for LtHash, the lattice-based set hash you can update by adding. Add and remove items and watch the digest follow word by word, run the deployed 16-bit instance against its reference vector, then cancel the modulus one bit at a time until a set of items hashes to all zeros — with every collision re-hashed from scratch by a checker that never sees the attack.

> **Not production cryptography — a teaching demo.** Everything runs in your browser; there is no backend and nothing is stored. The BLAKE2b and BLAKE2Xb code here is hand-rolled for transparency, not for constant-time safety. For real use, take the audited implementation in [Folly](https://github.com/facebook/folly/tree/main/folly/crypto).

## What It Is

LtHash hashes a **set** by hashing each element into a long vector of small numbers and adding the vectors up:

```
LtHash_{N,d}(S) = Σ_{x ∈ S} H(x)   in (Z/2^d)^N
```

Because the digest is a sum, an element can be added or removed in time proportional to that one element: add its vector, or subtract it. Nothing else is recomputed. That is what makes the hash usable as a live checksum over a database that changes all day.

The **deployed instance** is N = 1024 words of d = 16 bits — a 2,048-byte digest — with H the first 1,024 little-endian 16-bit words of a 2,048-byte **BLAKE2Xb** expansion. That is the parameter set Folly ships and the one this lab reproduces against Folly's own test vector. BLAKE2b is specified in [RFC 7693](https://www.rfc-editor.org/rfc/rfc7693); BLAKE2Xb is its extendable-output mode, and it is hand-rolled here in [`src/hash/blake2b.ts`](src/hash/blake2b.ts) and [`src/hash/blake2xb.ts`](src/hash/blake2xb.ts) because the browser has no BLAKE2 and because the usual library APIs hide the parameter-block fields the extendable-output mode is built out of.

The **security model** is set-collision resistance in the random oracle model: no adversary should find two distinct finite sets with the same digest. That reduces to the average-case hardness of **ternary SIS** — finding a non-zero vector with coefficients in {−1, 0, 1} in the kernel of a random matrix — because a collision between two sets is exactly the difference of their indicator vectors.

And that is where the power-of-two modulus bites. A modulus of 2^d factors, so an attacker can peel the factors off one at a time: among any N + 1 vectors some non-empty subset sums to an even number in every word, and halving that sum lands in a modulus one bit smaller. Repeat d times and the result is a set whose digest is zero. This lab runs that recursion for real at reduced sizes, and runs the 2026 improvement that cancels **two** bits per step while keeping the coefficients ternary.

**Primitives and sources.**

- LtHash was introduced by Mihir Bellare and Daniele Micciancio, *A New Paradigm for Collision-Free Hashing: Incrementality at Reduced Cost*, EUROCRYPT 1997, LNCS 1233, pp. 163–192 ([doi:10.1007/3-540-69053-0_13](https://doi.org/10.1007/3-540-69053-0_13)).
- It was revived and deployed by Kevin Lewi, Wonho Kim, Ilya Maykov and Stephen Weis, *Securing Update Propagation with Homomorphic Hashing*, IACR ePrint [2019/227](https://eprint.iacr.org/2019/227), with the implementation released in Facebook's Folly library.
- The attack is Rui Ding, Xiaorui Gong, Hao Jiang and Lili Tang, *Two-Bit Lifting for Ternary SIS: Polynomial-Time Collision Attacks on LtHash*, IACR ePrint [2026/2083](https://eprint.iacr.org/2026/2083). It also documents the one-bit recursion, a folklore construction it attributes to Regev via Yilei Chen, Qipeng Liu and Mark Zhandry, *Quantum Algorithms for Variants of Average-Case Lattice Problems via Filtering*, EUROCRYPT 2022, LNCS 13277, pp. 372–401, Appendix A.

## Exhibits

1. **A Hash You Can Update** — Choose a reduced instance (N words of d bits), then add and remove items and watch which words of the digest move. The panel shows the digest before, the item's own vector, and the digest after, so the word-wise addition is visible rather than asserted. Three claims are computed on both sides and compared: the running digest against a full recomputation, the set hashed forwards against the same set reversed, and a round trip that adds an item and removes it again — run through the same `add` and `remove` the controls drive. Set mode refuses a duplicate; multiset mode allows it; removing an item that was never added is allowed, because the arithmetic cannot refuse it, and the page says so.
2. **The Real One** — N = 1024, d = 16, at full size in the browser. It reproduces the checksum printed in Folly's own `addObjectWithKnownValue` test by running the same four operations (add "a", add "b", add "hello", remove "b"), shows the same digest reached from only the two items that remain, and has the browser's own SHA-256 agree about the 2,048 bytes. Twelve random updates are then checked against a full recomputation, and a digest of the wrong length is refused with the cause named.
3. **Cancel One Bit** — The move the whole attack is made of, at a size where every number is readable. N + 1 items are hashed, their low bits form an N × (N + 1) matrix over the two-element field, and the elimination is replayed **step by step on the matrix the page is showing** — swap, pivot, clear — until the subset is highlighted. The subset sum is shown as integers (even in every word) and then halved into a modulus one bit smaller.
4. **Cancel Them All** — The centrepiece. Press "cancel the next bit" and watch the working modulus fall from 2^d to 1 while the list of base items behind the surviving vector changes under you. When the modulus reaches 1 the surviving vector is all zeros. Then press "re-hash the set": the item names go to a checker in [`src/check/verify.ts`](src/check/verify.ts) that imports only the hash, re-hashes every item, adds the vectors itself and compares all N words. A second pair, S ∪ T against T, shows the collision is not an artefact of comparing with the empty set. The measured query count sits beside (N + 1)^d, and beside 1025^16 computed exactly with `BigInt` for the deployed instance.
5. **Two Bits At A Time** — The 2026 paper's improvement, implemented from the paper. Each layer cancels two modulus bits instead of one: it kills the parity with a subset of a retained basis, then solves a second binary system for **signs** that push the combination into 4·(Z/2^s)^N. Changing a sign preserves parity, because −1 ≡ 1 (mod 2), so the first cancellation survives the second step and the coefficients stay in {−1, 0, 1} — which is why the result is two sets rather than one. The run is self-certifying through the same independent checker, the measured query count is compared with (N + 1)^d at the same size, and the paper's own cost formulas are evaluated in the page for N = 1024, d = 16.
6. **Updates Correct, Sets Different** — The negative-claim exhibit. Two different sets, produced by the recursion, in a state where **every check the page performs reports success**: each digest maintained incrementally equals the digest recomputed from scratch, and a round trip returns both exactly. The sets share no item and their digests are identical in every word. The construction has no failure code to raise, and the page says so rather than inventing one.

Several exhibits end with an optional quick check — one question with an immediate explanation — aimed at a common misconception. The lab is fully usable whether or not you answer them.

## When to Use It

- **Use** a homomorphic set hash when you need one digest over a large, changing set and cannot afford to re-read the whole set on every change: replica comparison, update propagation, blockchain state commitments.
- **Use** a **large prime modulus** for a new design. The power-of-two modulus is what makes the recursion in exhibits 4 and 5 possible, and the paper recommends prime moduli for future LtHash designs for exactly that reason.
- **Do NOT** read this page as a practical break of the deployed instance. Nothing here produces a collision for N = 1024, d = 16. The attack exhibits run at reduced sizes, and the figures for the deployed size are an evaluation of the paper's formulas, not a computation anyone has performed.
- **Do NOT** conclude from equal digests that two replicas hold the same set unless you are relying on collision resistance, as a separate property from the update arithmetic you can watch working. Exhibit 6 is that distinction, demonstrated.
- **Do NOT** use this code in production. It is written to be read.

## Live Demo

**https://systemslibrarian.github.io/crypto-lab-lthash/**

Add and remove items and watch the digest follow; reproduce the Folly reference checksum at full size; step an elimination one row operation at a time; cancel every bit of the modulus and have an independent checker confirm the zero; run the two-bit recursion and compare its query count with the one-bit one — all in the browser, no install.

## What Can Go Wrong

- **A power-of-two modulus factors, and an attacker can peel the factors.** This is the root cause of everything in exhibits 3 to 5. Modulo 2^d, "even in every word" is a meaningful condition and dividing by two lands in the same kind of group one bit smaller. A prime modulus offers no such factor.
- **A claimed security level is not a measured one.** LtHash16 was estimated at **at least 200 bits** of collision security against generalized-birthday attacks. The 2026 paper reports about **2^81 hash queries** and under **2^101 scalar operations** over the two-element field, against its own estimates of about 2^180 operations for the one-bit recursion and 2^187.5 for the state-of-the-art generalized-birthday attack. The construction did not change; the best known algorithm did.
- **Digest length is an upper bound on security, never a measurement of it.** A 2,048-byte digest is 16,384 bits, and a birthday bound would suggest 2^8,192 work. The real cost is set by how hard it is to find a short relation in a structured group.
- **Correct updating is not collision resistance.** Exhibit 6 holds a state where every check a deployment could run reports success and two different sets still collide. There is no error code for it.
- **Wrap-around is silent.** Word arithmetic is modulo 2^d with no carry out, so a word that passes 2^d simply wraps. That is the construction working as specified, and it is also why nothing in the digest records how many items went into it.

## Real-World Usage

Only deployments that can be cited:

- **Facebook / Meta** deployed LtHash for the update-propagation step of a configuration-management system and open-sourced the implementation in Folly in March 2019 ([engineering.fb.com](https://engineering.fb.com/2019/03/01/security/homomorphic-hashing/), and ePrint 2019/227). Folly's instance is N = 1024, d = 16 with the BLAKE2Xb expansion this lab reproduces.
- **Solana** adopted an accounts lattice hash of the same shape — 1,024 sixteen-bit elements, 2,048 bytes, arithmetic modulo 2^16 — in SIMD-0215, *Homomorphic Hashing of Account State* (activated; authors Brooks Prumo, Emanuele Cesena, Josh Siegel and Sam Kim). Note that SIMD-0215 instantiates the expansion with **BLAKE3**, not BLAKE2Xb: the group and the parameters are the same, the inner hash is not.
- Table 1 of ePrint 2026/2083 lists further adopters at the same (1024, 16) parameters, and a 64-word instance at WhatsApp. Those rows are the paper's, cited as the paper's rather than independently confirmed here.

## How to Run Locally

```bash
npm install
npm run dev           # http://localhost:5173/crypto-lab-lthash/
npm run build         # typecheck + production build to dist/
npm test              # unit tests: the Folly vector, RFC 7693, both recursions
npm run test:a11y     # the whole browser suite: axe gate, claims, verdicts, coverage
npm run test:claims   # just the claims suite
npm run test:verdicts # just the verdict and coverage suites
npm run test:mutation # apply, judge and revert the eight recorded mutations
npm run mutate list   # what those mutations are and what each one must kill
```

## Related Demos

- [crypto-lab-lll-break](https://systemslibrarian.github.io/crypto-lab-lll-break/) — lattice reduction, the other way of attacking a short-vector problem.
- [crypto-lab-lattice-builder](https://systemslibrarian.github.io/crypto-lab-lattice-builder/) — bases, short vectors and the geometry behind SIS.
- [crypto-lab-collision-vault](https://systemslibrarian.github.io/crypto-lab-collision-vault/) — collisions in ordinary hash functions, where the birthday bound really is the bar.
- [crypto-lab-merkle-proofs](https://systemslibrarian.github.io/crypto-lab-merkle-proofs/) — the other way to keep a digest over a changing set, and what it costs to update.
- [crypto-lab-hash-zoo](https://systemslibrarian.github.io/crypto-lab-hash-zoo/) — the families this one is not a member of.

## Build & Verify

- **76 unit tests** (Vitest, colocated `src/**/*.test.ts`) and **36 browser tests** (Playwright), run in CI on every push and before every merge.
- **The Folly reference vector.** [`src/lthash/folly-vector.ts`](src/lthash/folly-vector.ts) holds the 2,048-byte checksum from `folly/crypto/test/LtHashTest.cpp`, test `addObjectWithKnownValue`, at commit `f416c5d1cac01f8f3a59bce209a9ebb877da7307`. The hex was extracted from the downloaded file by a script, never retyped, and the Apache-2.0 notice travels with it. [`src/lthash/lthash.test.ts`](src/lthash/lthash.test.ts) reproduces it two ways — by the four-step add/remove sequence and by adding only the two items that remain — and checks its SHA-256.
- **BLAKE2b against three implementations.** [`src/hash/blake2b.test.ts`](src/hash/blake2b.test.ts) checks the RFC 7693 Appendix A vector for `"abc"`, cross-checks `node:crypto`'s BLAKE2b-512 on messages from 0 to 10,000 bytes including a random-length sweep, and reproduces seven Python `hashlib` vectors covering short digests and the tree-parameter fields the extendable-output mode depends on.
- **The recursions, measured.** [`src/attack/onebit.test.ts`](src/attack/onebit.test.ts) runs the one-bit recursion at (4, 4), (6, 6) and (8, 6) and asserts the query count is exactly (N + 1)^d — 625, 117,649 and 531,441 — with every result re-hashed to zero by the independent checker. [`src/attack/twobit.test.ts`](src/attack/twobit.test.ts) runs the two-bit recursion at seven sizes, requires every result to pass the same checker, requires fewer queries than (N + 1)^d, and reproduces the paper's own figures from its formulas: p(1024, 550) ≈ 0.98982, an affine per-output cost of ≈ 1069.70x + 511.57, log₂ E[Q] ≈ 81.07, and the Table 4 budgets for the 20-bit and 32-bit instances.
- **A collision is never reported by the code that found it.** [`src/check/verify.ts`](src/check/verify.ts) imports only the hash — asserted by a test that reads its own module specifiers — and refuses a duplicate item, two equal sets, and any pair whose digests differ in any word.
- **Accessibility gate** — `@axe-core/playwright` scans the production build for **zero** WCAG 2.1 A/AA violations across every driven state at 1280px and 380px ([`e2e/a11y.spec.ts`](e2e/a11y.spec.ts)). The gate also asserts axe's `incomplete` bucket, computes contrast arithmetically over composited backdrops, measures non-text contrast on every control boundary, and checks reflow, scroller reachability and focus visibility — none of which axe has a rule for.
- **Claims and verdicts** — [`e2e/claims.spec.ts`](e2e/claims.spec.ts) re-derives the page's headline claims rather than re-asserting them: the homomorphism recomputed from three rendered word strips, (N + 1)^d recomputed with `BigInt` from the N and d on screen, H("b") recovered from the difference of two printed rows, and the deployed digest's SHA-256 recomputed with `node:crypto`. [`e2e/verdicts.spec.ts`](e2e/verdicts.spec.ts) asserts every rendered outcome's words and painted state together, and [`e2e/verdict-coverage.spec.ts`](e2e/verdict-coverage.spec.ts) fails the run if any verdict word, verdict styling or statistics value renders outside a marker.
- **Mutation ledger** — [`e2e/verdict-mutations.json`](e2e/verdict-mutations.json) records eight mutations as concrete patches, each naming the test and the exact claim that must kill it; [`scripts/mutate.mjs`](scripts/mutate.mjs) applies them in an isolated `git archive` tree and refuses to call anything a kill unless the baseline passed in the same run, the file really changed, the built bundle's hash moved, and the failure was the owning assertion. A global teardown independently fails the suite if a recorded kill never executed.
- **Gated CI and deployment** — one workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) runs the unit suite with its count asserted, the typechecked build and the whole browser gate **before merge**. Pull requests receive no Pages credentials and publish nothing; `main` stamps its exact source revision, deploys only after the same gate, and then verifies the served bytes carry that revision.

## Performance

Everything runs in the browser with no network I/O after the static load. One item of the deployed instance costs one BLAKE2b compression for the root hash plus one for each of the 32 output blocks, measured at about 93 µs; a reduced instance reads only the first output block and so costs two compressions, about 5.7 µs. The default attack size (N = 4, d = 4) hashes its 625 items in about 5 ms; the largest offered, (8, 6), hashes 531,441 items in about 3.7 s and is chunked so the page stays responsive. Instances whose (N + 1)^d exceeds 600,000 are refused with the count and the cap named, which is why the deployed instance cannot be attacked here: it would need 1025^16 ≈ 2^160 hash queries.

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
