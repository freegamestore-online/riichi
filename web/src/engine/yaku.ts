// ── Yaku detection (v0.2 subset) ──
//
// A trimmed set of the most common yaku for a playable single-player demo:
//
//   - riichi          (declared riichi)             1 han
//   - ippatsu         (win within 1 turn of riichi) 1 han  [closed]
//   - menzen tsumo    (concealed self-draw win)     1 han  [closed]
//   - pinfu           (all chis, non-yakuhai pair)  1 han  [closed]
//   - tanyao          (no terminals or honors)      1 han
//   - yakuhai         (triplet of value tile)       1 han each
//        round wind, seat wind, white/green/red dragon
//   - iipeikou        (two identical chis)          1 han  [closed]
//   - toitoi          (all pons)                    2 han
//   - honitsu         (one suit + honors)           3 han  [2 if open — n/a v0.2]
//   - chinitsu        (one suit, no honors)         6 han  [5 if open]
//
// Cuts (deliberately omitted for v0.2): rinshan, chankan, haitei, houtei,
// double riichi, sanshoku, ittsuu, chanta, junchan, sankantsu, daisangen,
// shousangen, yakuman set.

import { evaluateHand, type Meld, type WinShape } from "./evaluator";
import {
  type TileId,
  isHonor,
  isWind,
  isDragon,
  isTerminal,
  isTerminalOrHonor,
  numberOf,
  suitOf,
  Suit,
  toCounts,
} from "./tiles";
import type { OpenMeld } from "./game";

export type Wind = 0 | 1 | 2 | 3; // E S W N

export interface WinContext {
  /** Did the player declare riichi at least one turn before winning? */
  riichi: boolean;
  /** Did the win happen within one uninterrupted turn of riichi declaration? */
  ippatsu: boolean;
  /** True if the player drew the winning tile themselves (tsumo); false if ron. */
  tsumo: boolean;
  /** Round wind (East round = 0, South = 1). For v0.2 we only play East rounds. */
  roundWind: Wind;
  /** Player's seat wind. */
  seatWind: Wind;
  /** Dora tiles (the *targets*, not the indicators) — counts as 1 han per tile in hand. */
  doraTiles: TileId[];
  /** True if hand has no open melds. For v0.2 every hand is closed. */
  concealed: boolean;
}

export interface YakuEntry {
  name: string;
  han: number;
}

export interface YakuResult {
  yaku: YakuEntry[];
  doraCount: number;
  totalHan: number;
}

export function detectYaku(
  concealedTiles: TileId[],
  winningTile: TileId,
  openMelds: OpenMeld[],
  ctx: WinContext,
): YakuResult | null {
  const shape = evaluateHand(concealedTiles, openMelds.length);
  if (!shape) return null;

  // Yaku checks look at the entire 14-tile hand for tile-content predicates.
  // Build that here from concealed + open meld tiles.
  const allTiles: TileId[] = [...concealedTiles];
  for (const m of openMelds) {
    if (m.type === "pon") {
      allTiles.push(m.baseTile, m.baseTile, m.baseTile);
    } else {
      allTiles.push(m.baseTile, (m.baseTile + 1) as TileId, (m.baseTile + 2) as TileId);
    }
  }

  const yaku: YakuEntry[] = [];

  // ── Riichi family (state-driven, closed-only) ──
  if (ctx.riichi && ctx.concealed) {
    yaku.push({ name: "Riichi", han: 1 });
    if (ctx.ippatsu) yaku.push({ name: "Ippatsu", han: 1 });
  }

  // ── Tsumo (concealed self-draw) ──
  if (ctx.tsumo && ctx.concealed) {
    yaku.push({ name: "Menzen Tsumo", han: 1 });
  }

  // ── Shape-driven yaku ──
  yaku.push(...detectShapeYaku(shape, winningTile, openMelds, ctx));

  // ── Tile-content yaku ──
  if (allSimple(allTiles)) yaku.push({ name: "Tanyao", han: 1 });

  // ── Suit composition ──
  const suitYaku = suitCompositionYaku(allTiles, ctx.concealed);
  if (suitYaku) yaku.push(suitYaku);

  // ── Dora ──
  const dora = countDora(allTiles, ctx.doraTiles);

  const totalHan = yaku.reduce((s, y) => s + y.han, 0) + dora;
  return { yaku, doraCount: dora, totalHan };
}

// ── Shape-derived yaku ──

function detectShapeYaku(
  shape: WinShape,
  _winningTile: TileId,
  openMelds: OpenMeld[],
  ctx: WinContext,
): YakuEntry[] {
  const out: YakuEntry[] = [];

  // Chiitoitsu (closed-only by definition — evaluator already enforced this).
  if (shape.kind === "chiitoitsu") {
    out.push({ name: "Chiitoitsu", han: 2 });
    return out;
  }

  if (shape.kind === "kokushi") {
    out.push({ name: "Kokushi Musou (yakuman)", han: 13 });
    return out;
  }

  // Combine concealed decomposition with open melds for shape-level counts.
  const allConcealedMelds: Meld[] = shape.melds;
  const openMeldShapes: Meld[] = openMelds.map((m) =>
    m.type === "pon"
      ? ({ type: "pon", tile: m.baseTile } as const)
      : ({ type: "chi", baseTile: m.baseTile } as const),
  );
  const allMelds: Meld[] = [...allConcealedMelds, ...openMeldShapes];
  const pons = allMelds.filter((m) => m.type === "pon");
  const chis = allMelds.filter((m) => m.type === "chi");

  // Yakuhai — each triplet of a value tile is +1 han.
  for (const m of pons) {
    const t = m.tile;
    if (isDragon(t)) {
      out.push({ name: `Yakuhai (${dragonName(t)})`, han: 1 });
    } else if (isWind(t)) {
      if (windIndex(t) === ctx.roundWind) {
        out.push({ name: "Yakuhai (Round wind)", han: 1 });
      }
      if (windIndex(t) === ctx.seatWind) {
        out.push({ name: "Yakuhai (Seat wind)", han: 1 });
      }
    }
  }

  // Pinfu: all chis, non-yakuhai pair, closed.
  if (chis.length === 4 && pons.length === 0 && ctx.concealed) {
    const pair = shape.pair;
    const pairIsYakuhai =
      isDragon(pair) ||
      (isWind(pair) && (windIndex(pair) === ctx.roundWind || windIndex(pair) === ctx.seatWind));
    if (!pairIsYakuhai) {
      out.push({ name: "Pinfu", han: 1 });
    }
  }

  // Iipeikou: two identical chis (closed only — open chis disqualify).
  if (ctx.concealed && chis.length >= 2) {
    const seen = new Set<number>();
    let hasPair = false;
    for (const c of chis) {
      if (c.type !== "chi") continue;
      if (seen.has(c.baseTile)) {
        hasPair = true;
        break;
      }
      seen.add(c.baseTile);
    }
    if (hasPair) out.push({ name: "Iipeikou", han: 1 });
  }

  // Toitoi: all pons (including open pons).
  if (pons.length === 4) {
    out.push({ name: "Toitoi", han: 2 });
  }

  return out;
}

// ── Tile content predicates ──

function allSimple(tiles: TileId[]): boolean {
  for (const t of tiles) {
    if (isTerminalOrHonor(t)) return false;
  }
  return true;
}

function suitCompositionYaku(tiles: TileId[], concealed: boolean): YakuEntry | null {
  const suitsPresent = new Set<Suit>();
  let hasHonor = false;
  for (const t of tiles) {
    if (isHonor(t)) hasHonor = true;
    else suitsPresent.add(suitOf(t));
  }
  if (suitsPresent.size !== 1) return null;
  // One suit (plus optionally honors).
  if (hasHonor) {
    return { name: "Honitsu", han: concealed ? 3 : 2 };
  }
  return { name: "Chinitsu", han: concealed ? 6 : 5 };
}

function countDora(tiles: TileId[], doraTiles: TileId[]): number {
  const counts = toCounts(tiles);
  let n = 0;
  for (const d of doraTiles) n += counts[d] ?? 0;
  return n;
}

function windIndex(id: TileId): Wind {
  if (id < 27 || id > 30) throw new Error(`Not a wind tile: ${id}`);
  return (id - 27) as Wind;
}

function dragonName(id: TileId): string {
  if (id === 31) return "White";
  if (id === 32) return "Green";
  if (id === 33) return "Red";
  throw new Error(`Not a dragon tile: ${id}`);
}

// Re-exported helpers used by other engine modules.
export { isTerminal, isHonor, numberOf };
