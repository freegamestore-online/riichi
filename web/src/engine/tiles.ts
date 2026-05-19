// ── Riichi Mahjong tile system ──
//
// 34 tile types × 4 copies = 136 tiles. No flowers/seasons (those are bonus
// tiles in some variants and not used in standard Riichi).
//
// Tile id (0-33) encodes type:
//   0-8   = manzu (characters) 1m..9m
//   9-17  = pinzu (circles)    1p..9p
//   18-26 = souzu (bamboo)     1s..9s
//   27-30 = winds:  E S W N    (27=East, 28=South, 29=West, 30=North)
//   31-33 = dragons: White Green Red  (31=Haku, 32=Hatsu, 33=Chun)

export type TileId = number; // 0..33

export const enum Suit {
  Man = 0,
  Pin = 1,
  Sou = 2,
  Honor = 3,
}

export interface TileMeta {
  id: TileId;
  suit: Suit;
  number: number; // 1-9 for suits; for honors: wind 1-4 (E,S,W,N) or dragon 1-3 (W,G,R)
  isHonor: boolean;
  isTerminal: boolean; // 1 or 9 in a suit
  isTerminalOrHonor: boolean;
  isWind: boolean;
  isDragon: boolean;
  glyph: string;
  label: string;
}

// Unicode mahjong tile glyphs.
// Characters (manzu): 🀇🀈🀉🀊🀋🀌🀍🀎🀏 = U+1F007..U+1F00F
// Circles (pinzu):    🀙🀚🀛🀜🀝🀞🀟🀠🀡 = U+1F019..U+1F021
// Bamboo (souzu):     🀐🀑🀒🀓🀔🀕🀖🀗🀘 = U+1F010..U+1F018
// Winds:              🀀🀁🀂🀃             = U+1F000..U+1F003 (E,S,W,N)
// Dragons:            🀆🀅🀄              (White, Green, Red)
const MAN_BASE = 0x1f007;
const PIN_BASE = 0x1f019;
const SOU_BASE = 0x1f010;
const WIND_GLYPHS = ["🀀", "🀁", "🀂", "🀃"];
const DRAGON_GLYPHS = ["🀆", "🀅", "🀄"];

const WIND_LABELS = ["East", "South", "West", "North"];
const DRAGON_LABELS = ["White", "Green", "Red"];

export const TILES: TileMeta[] = (() => {
  const out: TileMeta[] = [];
  // Manzu 1-9
  for (let n = 1; n <= 9; n++) {
    out.push({
      id: n - 1,
      suit: Suit.Man,
      number: n,
      isHonor: false,
      isTerminal: n === 1 || n === 9,
      isTerminalOrHonor: n === 1 || n === 9,
      isWind: false,
      isDragon: false,
      glyph: String.fromCodePoint(MAN_BASE + n - 1),
      label: `${n}m`,
    });
  }
  // Pinzu 1-9
  for (let n = 1; n <= 9; n++) {
    out.push({
      id: 9 + n - 1,
      suit: Suit.Pin,
      number: n,
      isHonor: false,
      isTerminal: n === 1 || n === 9,
      isTerminalOrHonor: n === 1 || n === 9,
      isWind: false,
      isDragon: false,
      glyph: String.fromCodePoint(PIN_BASE + n - 1),
      label: `${n}p`,
    });
  }
  // Souzu 1-9
  for (let n = 1; n <= 9; n++) {
    out.push({
      id: 18 + n - 1,
      suit: Suit.Sou,
      number: n,
      isHonor: false,
      isTerminal: n === 1 || n === 9,
      isTerminalOrHonor: n === 1 || n === 9,
      isWind: false,
      isDragon: false,
      glyph: String.fromCodePoint(SOU_BASE + n - 1),
      label: `${n}s`,
    });
  }
  // Winds E,S,W,N
  for (let n = 0; n < 4; n++) {
    out.push({
      id: 27 + n,
      suit: Suit.Honor,
      number: n + 1,
      isHonor: true,
      isTerminal: false,
      isTerminalOrHonor: true,
      isWind: true,
      isDragon: false,
      glyph: WIND_GLYPHS[n]!,
      label: WIND_LABELS[n]!,
    });
  }
  // Dragons W,G,R
  for (let n = 0; n < 3; n++) {
    out.push({
      id: 31 + n,
      suit: Suit.Honor,
      number: n + 1,
      isHonor: true,
      isTerminal: false,
      isTerminalOrHonor: true,
      isWind: false,
      isDragon: true,
      glyph: DRAGON_GLYPHS[n]!,
      label: DRAGON_LABELS[n]!,
    });
  }
  return out;
})();

if (TILES.length !== 34) {
  throw new Error(`TILES must have 34 entries, got ${TILES.length}`);
}

// Convenience accessors
export const tile = (id: TileId): TileMeta => TILES[id]!;
export const glyph = (id: TileId): string => TILES[id]!.glyph;
export const label = (id: TileId): string => TILES[id]!.label;

// Sort tile ids in canonical hand order (ascending by id, which puts m < p < s < winds < dragons,
// and numbered tiles in numeric order).
export function sortTiles(ids: TileId[]): TileId[] {
  return [...ids].sort((a, b) => a - b);
}

// Honor / terminal helpers
export const isHonor = (id: TileId): boolean => id >= 27;
export const isWind = (id: TileId): boolean => id >= 27 && id <= 30;
export const isDragon = (id: TileId): boolean => id >= 31 && id <= 33;
export const isTerminal = (id: TileId): boolean => {
  if (isHonor(id)) return false;
  const n = (id % 9) + 1;
  return n === 1 || n === 9;
};
export const isTerminalOrHonor = (id: TileId): boolean => isHonor(id) || isTerminal(id);
export const suitOf = (id: TileId): Suit => {
  if (id < 9) return Suit.Man;
  if (id < 18) return Suit.Pin;
  if (id < 27) return Suit.Sou;
  return Suit.Honor;
};
export const numberOf = (id: TileId): number => {
  if (isHonor(id)) return 0;
  return (id % 9) + 1;
};

// Convert a count-per-id array (length 34) to a sorted tile-id list.
export function fromCounts(counts: number[]): TileId[] {
  const out: TileId[] = [];
  for (let i = 0; i < 34; i++) {
    const c = counts[i] ?? 0;
    for (let k = 0; k < c; k++) out.push(i);
  }
  return out;
}

// Convert a tile-id list to a count-per-id array (length 34).
export function toCounts(ids: TileId[]): number[] {
  const counts = new Array<number>(34).fill(0);
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

// Parse a shorthand string like "123m456p789sEEE" into a tile-id list.
// Useful for tests and fixtures.
//   suits: m/p/s with digits 1-9
//   honors: capital letters E S W N (winds) and W/G/R Haku/Hatsu/Chun
//     We use lowercase letters for honors to avoid ambiguity with suit letters:
//       e=East s=South w=West n=North (wait — collision with souzu 's')
//   Final scheme: digits-then-suit-letter as usual, and honors written as
//     E1 S1 W1 N1 (winds) and D1 D2 D3 (dragons: white, green, red).
//
// Simplest, unambiguous scheme used in this codebase:
//   - "Xm" / "Xp" / "Xs" where X is digits 1-9 (e.g. "123m" = 1m 2m 3m).
//   - "z" suit for honors: 1=E 2=S 3=W 4=N 5=White 6=Green 7=Red (standard tenhou notation).
//   - Multiple groups concatenated, e.g. "123m456p789s11z2z2z".
export function parseHand(spec: string): TileId[] {
  const out: TileId[] = [];
  const groups = spec.match(/(\d+)([mpsz])/g) ?? [];
  for (const g of groups) {
    const m = g.match(/(\d+)([mpsz])/)!;
    const digits = m[1]!;
    const suit = m[2]!;
    for (const d of digits) {
      const n = parseInt(d, 10);
      if (suit === "m") out.push(n - 1);
      else if (suit === "p") out.push(9 + n - 1);
      else if (suit === "s") out.push(18 + n - 1);
      else if (suit === "z") {
        if (n >= 1 && n <= 4) out.push(27 + n - 1); // winds
        else if (n >= 5 && n <= 7) out.push(31 + n - 5); // dragons
        else throw new Error(`Invalid honor index ${n} in ${spec}`);
      }
    }
  }
  return out;
}

// Inverse of parseHand — for debug/test labels.
export function formatHand(ids: TileId[]): string {
  const sorted = sortTiles(ids);
  let out = "";
  let buf = "";
  let currentSuit: string | null = null;
  for (const id of sorted) {
    let suit: string;
    let n: number;
    if (id < 9) {
      suit = "m";
      n = id + 1;
    } else if (id < 18) {
      suit = "p";
      n = id - 9 + 1;
    } else if (id < 27) {
      suit = "s";
      n = id - 18 + 1;
    } else if (id < 31) {
      suit = "z";
      n = id - 27 + 1;
    } else {
      suit = "z";
      n = id - 31 + 5;
    }
    if (suit !== currentSuit) {
      if (currentSuit) out += buf + currentSuit;
      buf = "";
      currentSuit = suit;
    }
    buf += String(n);
  }
  if (currentSuit) out += buf + currentSuit;
  return out;
}
