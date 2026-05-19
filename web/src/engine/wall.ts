// ── Wall + initial deal ──
//
// 136-tile wall: 34 types × 4 copies. The dead wall is the last 14 tiles
// (reserved for kan replacements + dora indicators). The live wall is the
// rest, drawn one tile at a time.

import { type TileId } from "./tiles";

export interface Wall {
  /** Tiles remaining in the live wall (LIFO — pop from the end). */
  live: TileId[];
  /** Dead wall (last 14 tiles of the original wall). */
  dead: TileId[];
  /** Dora indicators currently revealed (start at 1). */
  doraIndicators: TileId[];
}

export interface InitialDeal {
  hands: [TileId[], TileId[], TileId[], TileId[]]; // seat 0=East 1=South 2=West 3=North
  wall: Wall;
}

function newDeck(): TileId[] {
  const tiles: TileId[] = [];
  for (let t = 0; t < 34; t++) {
    for (let k = 0; k < 4; k++) tiles.push(t);
  }
  return tiles;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Standard Riichi deal:
 * - 4 hands of 13 tiles each
 * - Dealer (seat 0) draws their 14th tile to start
 * - Dead wall = last 14 tiles of the original 136
 * - 1 dora indicator revealed
 *
 * The dealer's 14th tile is NOT pre-drawn here — we return 13-tile hands and
 * let the turn engine draw the first tile for the dealer. This keeps draw
 * semantics uniform for every turn.
 */
export function dealHand(): InitialDeal {
  const all = shuffle(newDeck());
  // Last 14 = dead wall
  const dead = all.slice(all.length - 14);
  const live = all.slice(0, all.length - 14); // 122 tiles

  const hands: TileId[][] = [[], [], [], []];
  // Deal 13 to each, round-robin in groups of 4 (mahjong convention is groups
  // of 4, but for a random shuffle it doesn't matter — each player just gets
  // 13 distinct draw positions).
  for (let i = 0; i < 13; i++) {
    for (let p = 0; p < 4; p++) {
      hands[p]!.push(live.pop()!);
    }
  }

  // Dora indicator: revealed from dead wall position. Convention is the 3rd
  // tile from the end of the dead wall (kan tiles + ura dora indicators sit
  // around it), but for v0.2 a single indicator off the dead wall is enough.
  const doraIndicators: TileId[] = [dead[4]!];

  return {
    hands: hands as InitialDeal["hands"],
    wall: { live, dead, doraIndicators },
  };
}

/**
 * Tile pointed at by a dora indicator. For numbered tiles, the dora is
 * (indicator + 1) within the same suit, wrapping 9 → 1. For winds, the cycle
 * is E → S → W → N → E. For dragons, White → Green → Red → White.
 */
export function indicatorToDora(indicator: TileId): TileId {
  if (indicator < 9) return ((indicator + 1) % 9) as TileId; // man
  if (indicator < 18) return (9 + ((indicator - 9 + 1) % 9)) as TileId; // pin
  if (indicator < 27) return (18 + ((indicator - 18 + 1) % 9)) as TileId; // sou
  if (indicator < 31) return (27 + ((indicator - 27 + 1) % 4)) as TileId; // winds
  return (31 + ((indicator - 31 + 1) % 3)) as TileId; // dragons
}

/** Draw the next tile from the live wall. Mutates the wall. */
export function drawTile(wall: Wall): TileId | null {
  if (wall.live.length === 0) return null;
  return wall.live.pop()!;
}

/** Number of remaining draws before exhaustive draw (ryuukyoku). */
export function tilesRemaining(wall: Wall): number {
  return wall.live.length;
}
