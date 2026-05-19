// ── Hand evaluator ──
//
// Given a 14-tile hand, determine whether it forms a complete winning shape,
// and return one canonical decomposition. Three shapes are recognised:
//
//   1. Standard:    4 sets + 1 pair, where each set is a chi (consecutive run
//                   of three in one suit) or a pon (three of the same tile).
//   2. Chiitoitsu:  7 distinct pairs (14 tiles, no two pairs share a tile).
//   3. Kokushi:     13 terminals/honors all present plus one of them doubled.
//
// We return the first valid decomposition we find. Some yaku (toitoi vs
// iipeikou, etc.) can vary across alternative decompositions — for v0.2 this
// first-decomposition limitation is acceptable.

import { type TileId, toCounts, isHonor } from "./tiles";

export type Meld =
  | { type: "chi"; baseTile: TileId } // consecutive run starting at baseTile
  | { type: "pon"; tile: TileId };

export type WinShape =
  | { kind: "standard"; pair: TileId; melds: Meld[] }
  | { kind: "chiitoitsu"; pairs: TileId[] }
  | { kind: "kokushi"; head: TileId };

const TERMINALS_AND_HONORS: TileId[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export function evaluateHand(tiles: TileId[]): WinShape | null {
  if (tiles.length !== 14) return null;
  const counts = toCounts(tiles);
  return tryKokushi(counts) ?? tryChiitoitsu(counts) ?? tryStandard(counts);
}

// 1 tile away from winning?
export function isTenpai(tiles: TileId[]): boolean {
  if (tiles.length !== 13) return false;
  for (let i = 0; i < 34; i++) {
    const candidate = [...tiles, i as TileId];
    if (evaluateHand(candidate)) return true;
  }
  return false;
}

// All tiles that would complete the tenpai hand.
export function waits(tiles: TileId[]): TileId[] {
  if (tiles.length !== 13) return [];
  const out: TileId[] = [];
  for (let i = 0; i < 34; i++) {
    const candidate = [...tiles, i as TileId];
    if (evaluateHand(candidate)) out.push(i);
  }
  return out;
}

// ── Kokushi musou (13 orphans) ──
function tryKokushi(counts: number[]): WinShape | null {
  let head: TileId | null = null;
  for (const t of TERMINALS_AND_HONORS) {
    const c = counts[t] ?? 0;
    if (c === 0) return null;
    if (c === 2) {
      if (head !== null) return null;
      head = t;
    } else if (c > 2) return null;
  }
  if (head === null) return null;
  // No non-terminal/honor tiles allowed
  for (let i = 0; i < 34; i++) {
    if (TERMINALS_AND_HONORS.includes(i)) continue;
    if ((counts[i] ?? 0) > 0) return null;
  }
  return { kind: "kokushi", head };
}

// ── Chiitoitsu (7 pairs) ──
function tryChiitoitsu(counts: number[]): WinShape | null {
  const pairs: TileId[] = [];
  for (let i = 0; i < 34; i++) {
    const c = counts[i] ?? 0;
    if (c === 0) continue;
    if (c === 2) pairs.push(i);
    else return null;
  }
  if (pairs.length !== 7) return null;
  return { kind: "chiitoitsu", pairs };
}

// ── Standard: 4 melds + 1 pair ──
function tryStandard(counts: number[]): WinShape | null {
  for (let p = 0; p < 34; p++) {
    if ((counts[p] ?? 0) >= 2) {
      counts[p]! -= 2;
      const melds = splitIntoMelds(counts);
      counts[p]! += 2;
      if (melds) return { kind: "standard", pair: p as TileId, melds };
    }
  }
  return null;
}

// Recursive decomposition into pons + chis. Always consume the lowest-id tile
// first to ensure each shape is reached by exactly one path.
function splitIntoMelds(counts: number[]): Meld[] | null {
  let first = -1;
  for (let i = 0; i < 34; i++) {
    if ((counts[i] ?? 0) > 0) {
      first = i;
      break;
    }
  }
  if (first === -1) return []; // empty — done

  // Try pon
  if (counts[first]! >= 3) {
    counts[first]! -= 3;
    const rest = splitIntoMelds(counts);
    counts[first]! += 3;
    if (rest) return [{ type: "pon", tile: first as TileId }, ...rest];
  }

  // Try chi — numbered suits only, and need room (first+2 same suit)
  if (!isHonor(first)) {
    const numWithinSuit = first % 9;
    if (
      numWithinSuit <= 6 &&
      (counts[first + 1] ?? 0) >= 1 &&
      (counts[first + 2] ?? 0) >= 1
    ) {
      counts[first]! -= 1;
      counts[first + 1]! -= 1;
      counts[first + 2]! -= 1;
      const rest = splitIntoMelds(counts);
      counts[first]! += 1;
      counts[first + 1]! += 1;
      counts[first + 2]! += 1;
      if (rest) return [{ type: "chi", baseTile: first as TileId }, ...rest];
    }
  }

  return null;
}
