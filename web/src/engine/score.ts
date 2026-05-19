// ── Scoring (naive) ──
//
// Riichi scoring proper involves fu (minipoints) plus han (multipliers) plus
// a base-points lookup with dealer/non-dealer transfer rules and special
// caps (mangan/haneman/baiman/sanbaiman/yakuman). v0.2 uses a simplified
// model:
//
//   - Fu: fixed at 30 for standard hands, 25 for chiitoitsu. (Real Riichi
//         scales fu by meld composition + wait + hand circumstances; we
//         skip that detail. It typically shifts the score by one or two
//         hundred points.)
//   - Base points = fu × 2^(2 + han), capped at 2000 (mangan).
//   - Han caps:
//        ≥ 13 han → yakuman   (8000 / 16000)
//        ≥ 11 han → sanbaiman (6000 / 12000)
//        ≥ 8 han  → baiman    (4000 / 8000)
//        ≥ 6 han  → haneman   (3000 / 6000)
//        ≥ 5 han  → mangan    (2000 / 4000)
//        Otherwise base-points formula.
//   - Ron from dealer → 6 × base, rounded up to 100.
//   - Ron from non-dealer → 4 × base, rounded up to 100.
//   - Tsumo dealer → all 3 pay 2 × base each (rounded up to 100).
//   - Tsumo non-dealer → dealer pays 2 × base, others pay 1 × base (each
//        rounded up to 100).
//
// The "round up to 100" rounding is applied per payer, matching standard
// Riichi conventions.

import { type WinShape } from "./evaluator";
import type { YakuResult } from "./yaku";

export interface ScoreInput {
  shape: WinShape;
  yakuResult: YakuResult;
  isDealer: boolean;
  isTsumo: boolean;
}

export interface ScoreOutput {
  /** Names of yaku that contributed, for display. */
  yakuNames: string[];
  /** Total han including dora. */
  han: number;
  /** Fu (minipoints) — fixed at 30 for v0.2, 25 for chiitoitsu. */
  fu: number;
  /** Total points the winner receives. */
  totalPoints: number;
  /** Per-payer breakdown: { fromDealer, fromEach, fromDiscarder }. */
  breakdown: PaymentBreakdown;
  /** Special-cap label, if any (Mangan/Haneman/etc.) */
  cap: string | null;
}

export interface PaymentBreakdown {
  /** Points the discarding loser pays (ron only). */
  fromDiscarder?: number;
  /** Points the dealer pays in non-dealer tsumo. */
  fromDealer?: number;
  /** Points each non-dealer pays in dealer tsumo, or each non-discarding non-dealer pays in non-dealer tsumo. */
  fromEach?: number;
}

const HAN_CAPS: Array<{ minHan: number; basePts: number; label: string }> = [
  { minHan: 13, basePts: 8000, label: "Yakuman" },
  { minHan: 11, basePts: 6000, label: "Sanbaiman" },
  { minHan: 8, basePts: 4000, label: "Baiman" },
  { minHan: 6, basePts: 3000, label: "Haneman" },
  { minHan: 5, basePts: 2000, label: "Mangan" },
];

function roundUp100(n: number): number {
  return Math.ceil(n / 100) * 100;
}

function basePoints(fu: number, han: number): { base: number; cap: string | null } {
  for (const cap of HAN_CAPS) {
    if (han >= cap.minHan) return { base: cap.basePts, cap: cap.label };
  }
  // Standard formula with mangan ceiling
  const raw = fu * 2 ** (2 + han);
  if (raw >= 2000) return { base: 2000, cap: "Mangan" };
  return { base: raw, cap: null };
}

export function scoreHand(input: ScoreInput): ScoreOutput {
  const { shape, yakuResult, isDealer, isTsumo } = input;
  const fu = shape.kind === "chiitoitsu" ? 25 : 30;
  const han = yakuResult.totalHan;
  const { base, cap } = basePoints(fu, han);

  if (isTsumo) {
    if (isDealer) {
      // Dealer tsumo: each of 3 non-dealers pays 2 × base.
      const fromEach = roundUp100(base * 2);
      return {
        yakuNames: yakuResult.yaku.map((y) => y.name),
        han,
        fu,
        totalPoints: fromEach * 3,
        breakdown: { fromEach },
        cap,
      };
    }
    // Non-dealer tsumo: dealer pays 2 × base, others pay 1 × base each.
    const fromDealer = roundUp100(base * 2);
    const fromEach = roundUp100(base);
    return {
      yakuNames: yakuResult.yaku.map((y) => y.name),
      han,
      fu,
      totalPoints: fromDealer + fromEach * 2,
      breakdown: { fromDealer, fromEach },
      cap,
    };
  }

  // Ron
  if (isDealer) {
    const fromDiscarder = roundUp100(base * 6);
    return {
      yakuNames: yakuResult.yaku.map((y) => y.name),
      han,
      fu,
      totalPoints: fromDiscarder,
      breakdown: { fromDiscarder },
      cap,
    };
  }
  const fromDiscarder = roundUp100(base * 4);
  return {
    yakuNames: yakuResult.yaku.map((y) => y.name),
    han,
    fu,
    totalPoints: fromDiscarder,
    breakdown: { fromDiscarder },
    cap,
  };
}
