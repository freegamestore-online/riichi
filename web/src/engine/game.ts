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

import { evaluateHand, isTenpai } from "./evaluator";
import { detectYaku, type Wind } from "./yaku";
import { scoreHand } from "./score";
import { sortTiles, type TileId } from "./tiles";
import { dealHand, drawTile, indicatorToDora, type Wall } from "./wall";

export type Seat = 0 | 1 | 2 | 3;
export type Phase = "awaiting-draw" | "awaiting-discard" | "ended";

export interface PlayerState {
  hand: TileId[]; // 13 or 14 (concealed + drawn)
  discards: TileId[];
  riichiDeclared: boolean;
  riichiTurn: number | null; // turn count when riichi was declared
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

/** Discard the tile at `handIndex` of the active player's hand. */
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
  next.active = nextSeat(seat);
  next.phase = "awaiting-draw";
  return draw(next);
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
  return discard(next, handIndex);
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
    ippatsu: player.riichiDeclared && state.turn === (player.riichiTurn ?? -1) + 1,
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

/** Try to ron on the last discard (only legal if it was someone else's). */
export function declareRon(state: GameState, ronner: Seat): GameState | null {
  if (state.phase !== "awaiting-draw") return null; // ron is called between discard and next draw — but we currently auto-draw, so adapt: allow ron when there is a pending lastDiscard
  // In v0.2 we evaluate ron eagerly after each discard (before auto-draw).
  // See checkForRon().
  void ronner;
  return null;
}

/**
 * Eagerly check whether any non-discarding seat (currently the human only)
 * can ron the latest discard. If so, finalise the hand. Returns either an
 * updated state (with result populated) or the original state.
 */
export function checkForRon(state: GameState): GameState {
  if (!state.lastDiscard) return state;
  const { tile, from } = state.lastDiscard;
  // For v0.2, only the human seat 0 calls ron.
  if (from === HUMAN_SEAT) return state;

  const player = state.players[HUMAN_SEAT]!;
  const candidate = sortTiles([...player.hand, tile]);
  if (candidate.length !== 14) return state;
  if (!evaluateHand(candidate)) return state;

  const ctx = {
    riichi: player.riichiDeclared,
    ippatsu: player.riichiDeclared && state.turn === (player.riichiTurn ?? -1) + 1,
    tsumo: false,
    roundWind: state.roundWind,
    seatWind: seatWind(HUMAN_SEAT, state.dealer),
    doraTiles: doraTiles(state),
    concealed: true,
  };
  const yaku = detectYaku(candidate, tile, ctx);
  if (!yaku || yaku.yaku.length === 0) return state;

  // Hand has yaku — return a "ron is available" preview without committing.
  // The UI calls commitRon() when the human chooses to call.
  return state;
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
    ippatsu: player.riichiDeclared && state.turn === (player.riichiTurn ?? -1) + 1,
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

/** Bot turn: random discard. The bot has already drawn a tile (auto-draw). */
export function botDiscard(state: GameState): GameState {
  if (state.phase !== "awaiting-discard") return state;
  if (state.active === HUMAN_SEAT) return state; // not a bot
  const hand = state.players[state.active]!.hand;
  if (hand.length === 0) return state;
  // Random discard for v0.2. A small bias: prefer discarding honors/terminals
  // we have only one of, to roughly approximate beginner play.
  const idx = pickBotDiscardIndex(hand);
  let next = discard(state, idx);
  next = checkForRon(next);
  return next;
}

function pickBotDiscardIndex(hand: TileId[]): number {
  // Simple heuristic: discard the first isolated honor or terminal we find;
  // otherwise discard a random tile.
  for (let i = 0; i < hand.length; i++) {
    const t = hand[i]!;
    if (t >= 27) {
      // honor — discard if only one copy
      let count = 0;
      for (const u of hand) if (u === t) count++;
      if (count === 1) return i;
    }
  }
  return Math.floor(Math.random() * hand.length);
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
    ippatsu: player.riichiDeclared && state.turn === (player.riichiTurn ?? -1) + 1,
    tsumo: true,
    roundWind: state.roundWind,
    seatWind: seatWind(HUMAN_SEAT, state.dealer),
    doraTiles: doraTiles(state),
    concealed: true,
  };
  const yaku = detectYaku(player.hand, state.lastDrawn!, ctx);
  return !!yaku && yaku.yaku.length > 0;
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
    ippatsu: player.riichiDeclared && state.turn === (player.riichiTurn ?? -1) + 1,
    tsumo: false,
    roundWind: state.roundWind,
    seatWind: seatWind(HUMAN_SEAT, state.dealer),
    doraTiles: doraTiles(state),
    concealed: true,
  };
  const yaku = detectYaku(candidate, state.lastDiscard.tile, ctx);
  return !!yaku && yaku.yaku.length > 0;
}
