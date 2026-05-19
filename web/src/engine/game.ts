// ── Turn engine ──
//
// State machine for a single Riichi hand (one "kyoku"). v0.2 simplifications:
//   - 4 players, seat 0 is the human, seats 1-3 are bots.
//   - Bots never call (chi/pon/kan), never declare riichi, never tsumo.
//     They just discard randomly each turn.
//   - Human can discard, declare riichi (if tenpai + concealed + can afford
//     the 1000-pt bet), declare tsumo on self-draw, or declare ron on a bot's
//     discard that completes their hand.
//   - East round, dealer is fixed at seat 0 (player) for the demo.
//   - On wall exhaustion: ryuukyoku (exhaustive draw). For v0.2 we skip
//     tenpai-payments and just end the hand at zero.

import { evaluateHand, isTenpai, waits as computeWaits } from "./evaluator";
import { detectYaku, type Wind } from "./yaku";
import { scoreHand } from "./score";
import { isHonor, isTerminal, numberOf, sortTiles, toCounts, type TileId } from "./tiles";
import { dealHand, drawTile, indicatorToDora, type Wall } from "./wall";

export type Seat = 0 | 1 | 2 | 3;
export type Phase = "awaiting-draw" | "awaiting-discard" | "ended";

export interface PlayerState {
  hand: TileId[]; // 13 or 14 (concealed + drawn)
  discards: TileId[];
  riichiDeclared: boolean;
  riichiTurn: number | null; // turn count when riichi was declared
  /**
   * True between riichi declaration and the declarer's next discard. Wins
   * within this window (ron off anyone, or tsumo on the next draw) earn the
   * ippatsu bonus han.
   */
  ippatsuActive: boolean;
}

export interface RoundResult {
  kind: "tsumo" | "ron" | "draw";
  winner?: Seat;
  loser?: Seat; // for ron only
  yakuNames?: string[];
  han?: number;
  fu?: number;
  totalPoints?: number;
  cap?: string | null;
}

export interface GameState {
  players: [PlayerState, PlayerState, PlayerState, PlayerState];
  scores: [number, number, number, number]; // running point totals
  wall: Wall;
  active: Seat;
  dealer: Seat;
  roundWind: Wind;
  phase: Phase;
  turn: number; // total turns elapsed (each draw = +1)
  lastDrawn: TileId | null; // tile just drawn by active player
  lastDiscard: { tile: TileId; from: Seat } | null;
  result: RoundResult | null;
}

export const HUMAN_SEAT: Seat = 0;
export const STARTING_POINTS = 25000;
export const RIICHI_BET = 1000;

// ── Construction ──

export function newGame(): GameState {
  const deal = dealHand();
  const players: PlayerState[] = deal.hands.map((h) => ({
    hand: sortTiles(h),
    discards: [],
    riichiDeclared: false,
    riichiTurn: null,
    ippatsuActive: false,
  }));

  const state: GameState = {
    players: players as GameState["players"],
    scores: [STARTING_POINTS, STARTING_POINTS, STARTING_POINTS, STARTING_POINTS],
    wall: deal.wall,
    active: 0,
    dealer: 0,
    roundWind: 0,
    phase: "awaiting-draw",
    turn: 0,
    lastDrawn: null,
    lastDiscard: null,
    result: null,
  };
  return draw(state);
}

// ── Pure transitions ──

function clone(state: GameState): GameState {
  return {
    players: state.players.map((p) => ({
      ...p,
      hand: [...p.hand],
      discards: [...p.discards],
    })) as GameState["players"],
    scores: [...state.scores] as GameState["scores"],
    wall: {
      live: [...state.wall.live],
      dead: [...state.wall.dead],
      doraIndicators: [...state.wall.doraIndicators],
    },
    active: state.active,
    dealer: state.dealer,
    roundWind: state.roundWind,
    phase: state.phase,
    turn: state.turn,
    lastDrawn: state.lastDrawn,
    lastDiscard: state.lastDiscard,
    result: state.result,
  };
}

function nextSeat(s: Seat): Seat {
  return ((s + 1) % 4) as Seat;
}

function seatWind(seat: Seat, dealer: Seat): Wind {
  return ((seat - dealer + 4) % 4) as Wind;
}

function doraTiles(state: GameState): TileId[] {
  return state.wall.doraIndicators.map((i) => indicatorToDora(i));
}

function draw(state: GameState): GameState {
  const next = clone(state);
  const tile = drawTile(next.wall);
  if (tile === null) {
    // Ryuukyoku (exhaustive draw).
    next.phase = "ended";
    next.result = { kind: "draw" };
    return next;
  }
  const seat = next.active;
  next.players[seat]!.hand.push(tile);
  next.lastDrawn = tile;
  next.phase = "awaiting-discard";
  next.turn += 1;
  return next;
}

// ── Public actions ──

/**
 * Discard the tile at `handIndex`. Does NOT auto-draw the next player — the
 * caller advances via `advance()` (or `commitRon()` if a ron is in range).
 * Splitting this lets the UI sit in `"awaiting-draw"` long enough for the
 * human to consider a call on a bot's discard.
 */
export function discard(state: GameState, handIndex: number): GameState {
  if (state.phase !== "awaiting-discard") return state;
  const seat = state.active;
  const player = state.players[seat]!;
  if (handIndex < 0 || handIndex >= player.hand.length) return state;

  const next = clone(state);
  const tile = next.players[seat]!.hand[handIndex]!;
  next.players[seat]!.hand.splice(handIndex, 1);
  next.players[seat]!.hand = sortTiles(next.players[seat]!.hand);
  next.players[seat]!.discards.push(tile);
  next.lastDiscard = { tile, from: seat };
  next.lastDrawn = null;
  // A discard by the riichi-declarer closes their ippatsu window.
  // (The declaration discard itself doesn't close it because declareRiichi
  // sets the flag *after* calling this function.)
  if (next.players[seat]!.ippatsuActive) {
    next.players[seat]!.ippatsuActive = false;
  }
  next.active = nextSeat(seat);
  next.phase = "awaiting-draw";
  return next;
}

/**
 * Advance from `awaiting-draw` to the next player's draw. The caller is
 * responsible for deciding whether to call ron first; if no call is being
 * made, this is the universal "next turn" step.
 */
export function advance(state: GameState): GameState {
  if (state.phase !== "awaiting-draw") return state;
  return draw(state);
}

/**
 * Declare riichi: must be active player on their discard step, with a tenpai
 * hand after discarding `handIndex`, fully concealed, and ≥1000 points.
 * Combines the riichi declaration with the discard.
 */
export function declareRiichi(state: GameState, handIndex: number): GameState | null {
  if (state.phase !== "awaiting-discard") return null;
  const seat = state.active;
  const player = state.players[seat]!;
  if (player.riichiDeclared) return null;
  if (state.scores[seat]! < RIICHI_BET) return null;
  if (handIndex < 0 || handIndex >= player.hand.length) return null;

  // Build the 13-tile hand that would remain after discarding handIndex.
  const remaining = [...player.hand];
  remaining.splice(handIndex, 1);
  if (!isTenpai(remaining)) return null;

  const next = clone(state);
  next.players[seat]!.riichiDeclared = true;
  next.players[seat]!.riichiTurn = state.turn;
  next.scores[seat] -= RIICHI_BET;
  // The discard is part of the riichi declaration.
  const afterDiscard = discard(next, handIndex);
  // Open the ippatsu window — set AFTER the discard so the discard's own
  // ippatsu-clearing branch doesn't immediately close it.
  afterDiscard.players[seat]!.ippatsuActive = true;
  return afterDiscard;
}

/** Try to declare tsumo on the just-drawn tile. */
export function declareTsumo(state: GameState): GameState | null {
  if (state.phase !== "awaiting-discard") return null;
  const seat = state.active;
  const player = state.players[seat]!;
  if (player.hand.length !== 14) return null;

  const winningTile = state.lastDrawn!;
  const ctx = {
    riichi: player.riichiDeclared,
    ippatsu: player.ippatsuActive,
    tsumo: true,
    roundWind: state.roundWind,
    seatWind: seatWind(seat, state.dealer),
    doraTiles: doraTiles(state),
    concealed: true,
  };
  const yaku = detectYaku(player.hand, winningTile, ctx);
  if (!yaku || yaku.yaku.length === 0) return null;

  const shape = evaluateHand(player.hand);
  if (!shape) return null;

  const score = scoreHand({
    shape,
    yakuResult: yaku,
    isDealer: seat === state.dealer,
    isTsumo: true,
  });

  const next = clone(state);
  applyTsumoTransfers(next, seat, score);
  next.phase = "ended";
  next.result = {
    kind: "tsumo",
    winner: seat,
    yakuNames: score.yakuNames,
    han: score.han,
    fu: score.fu,
    totalPoints: score.totalPoints,
    cap: score.cap,
  };
  return next;
}

/**
 * Commit a ron declaration: the human calls ron on the last bot discard.
 */
export function commitRon(state: GameState): GameState | null {
  if (!state.lastDiscard) return null;
  const { tile, from } = state.lastDiscard;
  if (from === HUMAN_SEAT) return null;

  const player = state.players[HUMAN_SEAT]!;
  const winningHand = sortTiles([...player.hand, tile]);
  if (winningHand.length !== 14) return null;
  const shape = evaluateHand(winningHand);
  if (!shape) return null;

  const ctx = {
    riichi: player.riichiDeclared,
    ippatsu: player.ippatsuActive,
    tsumo: false,
    roundWind: state.roundWind,
    seatWind: seatWind(HUMAN_SEAT, state.dealer),
    doraTiles: doraTiles(state),
    concealed: true,
  };
  const yaku = detectYaku(winningHand, tile, ctx);
  if (!yaku || yaku.yaku.length === 0) return null;

  const score = scoreHand({
    shape,
    yakuResult: yaku,
    isDealer: HUMAN_SEAT === state.dealer,
    isTsumo: false,
  });

  const next = clone(state);
  next.scores[HUMAN_SEAT] += score.totalPoints;
  next.scores[from] -= score.totalPoints;
  next.phase = "ended";
  next.result = {
    kind: "ron",
    winner: HUMAN_SEAT,
    loser: from,
    yakuNames: score.yakuNames,
    han: score.han,
    fu: score.fu,
    totalPoints: score.totalPoints,
    cap: score.cap,
  };
  return next;
}

/** Bot turn: random discard. The bot was already dealt a 14th tile by `draw()`. */
export function botDiscard(state: GameState): GameState {
  if (state.phase !== "awaiting-discard") return state;
  if (state.active === HUMAN_SEAT) return state; // not a bot
  const hand = state.players[state.active]!.hand;
  if (hand.length === 0) return state;
  const idx = pickBotDiscardIndex(hand);
  return discard(state, idx);
}

/**
 * "Usefulness" heuristic for bot discard selection. Each tile gets a score
 * based on how many pair/run partners it has in hand; the tile with the
 * lowest score is discarded. This is a poor man's shanten-distance: it
 * roughly tracks how many ways the tile contributes to a meld.
 *
 *   - +1 per other copy in hand (pair / triplet potential)
 *   - +1 for each immediate same-suit neighbour (n±1 — ryanmen / shuntsu)
 *   - +0.5 for each same-suit kanchan partner (n±2 — gapped wait)
 *   - small penalty on honors / terminals so they're preferred discards on ties
 *
 * This makes bots roughly approximate beginner play: keep pairs and runs,
 * throw out lone honors / orphan middles. It is NOT competitive AI but it
 * stops bots from gifting the human winning tiles every turn.
 */
function pickBotDiscardIndex(hand: TileId[]): number {
  const counts = toCounts(hand);
  let worstIdx = 0;
  let worstScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < hand.length; i++) {
    const t = hand[i]!;
    let score = 0;
    // Same-tile partners (counts includes self, so subtract 1).
    score += (counts[t] ?? 0) - 1;
    if (!isHonor(t)) {
      const n = numberOf(t);
      if (n > 1 && (counts[t - 1] ?? 0) > 0) score += 1;
      if (n < 9 && (counts[t + 1] ?? 0) > 0) score += 1;
      if (n > 2 && (counts[t - 2] ?? 0) > 0) score += 0.5;
      if (n < 8 && (counts[t + 2] ?? 0) > 0) score += 0.5;
    }
    // Bias toward discarding less-flexible tiles on ties.
    if (isHonor(t)) score -= 0.15;
    else if (isTerminal(t)) score -= 0.05;

    if (score < worstScore) {
      worstScore = score;
      worstIdx = i;
    }
  }
  return worstIdx;
}

// ── Score transfers ──

function applyTsumoTransfers(
  state: GameState,
  winner: Seat,
  score: ReturnType<typeof scoreHand>,
): void {
  if (winner === state.dealer) {
    const each = score.breakdown.fromEach ?? 0;
    for (let s = 0; s < 4; s++) {
      if (s !== winner) state.scores[s] = state.scores[s]! - each;
    }
    state.scores[winner] += each * 3;
  } else {
    const fromDealer = score.breakdown.fromDealer ?? 0;
    const each = score.breakdown.fromEach ?? 0;
    state.scores[state.dealer] -= fromDealer;
    state.scores[winner] += fromDealer;
    for (let s = 0; s < 4; s++) {
      if (s !== winner && s !== state.dealer) {
        state.scores[s] = state.scores[s]! - each;
        state.scores[winner] += each;
      }
    }
  }
}

// ── Diagnostic helpers (used by UI) ──

export function canDeclareRiichi(state: GameState): boolean {
  if (state.phase !== "awaiting-discard") return false;
  if (state.active !== HUMAN_SEAT) return false;
  const player = state.players[HUMAN_SEAT]!;
  if (player.riichiDeclared) return false;
  if (state.scores[HUMAN_SEAT]! < RIICHI_BET) return false;
  // Tenpai check: at least one discard leaves a tenpai shape.
  for (let i = 0; i < player.hand.length; i++) {
    const remaining = [...player.hand];
    remaining.splice(i, 1);
    if (isTenpai(remaining)) return true;
  }
  return false;
}

export function canDeclareTsumo(state: GameState): boolean {
  if (state.phase !== "awaiting-discard") return false;
  if (state.active !== HUMAN_SEAT) return false;
  const player = state.players[HUMAN_SEAT]!;
  if (player.hand.length !== 14) return false;
  if (!evaluateHand(player.hand)) return false;
  // Must have at least one yaku.
  const ctx = {
    riichi: player.riichiDeclared,
    ippatsu: player.ippatsuActive,
    tsumo: true,
    roundWind: state.roundWind,
    seatWind: seatWind(HUMAN_SEAT, state.dealer),
    doraTiles: doraTiles(state),
    concealed: true,
  };
  const yaku = detectYaku(player.hand, state.lastDrawn!, ctx);
  return !!yaku && yaku.yaku.length > 0;
}

/**
 * Returns the set of tile ids that, if added to the human's current 13-tile
 * hand, would complete a winning shape. Empty if the human isn't tenpai
 * (or it's their discard turn and they're holding 14 tiles).
 *
 * Caveat: this only checks SHAPE completion. Some "winning" tiles may yield
 * a yaku-less hand that can't actually be declared on ron; we don't filter
 * those out here because the cost is low and the UI is informational.
 */
export function humanWaits(state: GameState): TileId[] {
  const hand = state.players[HUMAN_SEAT]!.hand;
  // Use the 13-tile representation. If it's the human's discard turn (14
  // tiles), check waits over each possible discard and union them; otherwise
  // use the hand directly.
  if (hand.length === 13) return computeWaits(hand);
  if (hand.length === 14) {
    const all = new Set<TileId>();
    for (let i = 0; i < hand.length; i++) {
      const remaining = [...hand];
      remaining.splice(i, 1);
      for (const w of computeWaits(remaining)) all.add(w);
    }
    return [...all].sort((a, b) => a - b);
  }
  return [];
}

/**
 * For a 14-tile human hand on their discard step, return the set of hand
 * indices that, when discarded, leave a tenpai shape. Used to highlight
 * legal discards during riichi declaration so the user doesn't trial-and-
 * error their way through.
 */
export function legalRiichiDiscardIndices(state: GameState): number[] {
  if (state.phase !== "awaiting-discard") return [];
  if (state.active !== HUMAN_SEAT) return [];
  const hand = state.players[HUMAN_SEAT]!.hand;
  if (hand.length !== 14) return [];
  const out: number[] = [];
  for (let i = 0; i < hand.length; i++) {
    const remaining = [...hand];
    remaining.splice(i, 1);
    if (isTenpai(remaining)) out.push(i);
  }
  return out;
}

export function canDeclareRon(state: GameState): boolean {
  if (state.phase !== "awaiting-draw") return false;
  if (!state.lastDiscard) return false;
  if (state.lastDiscard.from === HUMAN_SEAT) return false;
  const player = state.players[HUMAN_SEAT]!;
  const candidate = sortTiles([...player.hand, state.lastDiscard.tile]);
  if (!evaluateHand(candidate)) return false;
  const ctx = {
    riichi: player.riichiDeclared,
    ippatsu: player.ippatsuActive,
    tsumo: false,
    roundWind: state.roundWind,
    seatWind: seatWind(HUMAN_SEAT, state.dealer),
    doraTiles: doraTiles(state),
    concealed: true,
  };
  const yaku = detectYaku(candidate, state.lastDiscard.tile, ctx);
  return !!yaku && yaku.yaku.length > 0;
}
