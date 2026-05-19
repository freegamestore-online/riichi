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
import {
  isDragon,
  isHonor,
  isTerminal,
  isWind,
  numberOf,
  sortTiles,
  toCounts,
  type TileId,
} from "./tiles";
import { dealHand, drawTile, indicatorToDora, type Wall } from "./wall";

export type Seat = 0 | 1 | 2 | 3;
export type Phase = "awaiting-draw" | "awaiting-discard" | "ended";

/**
 * An open meld on the table — a chi/pon/kan claimed off another player's
 * discard. The full 14-tile shape for a player is `hand ∪ melds` (each meld
 * contributes 3 or 4 tiles).
 */
export interface OpenMeld {
  type: "chi" | "pon";
  /** For chi: the lowest tile of the run. For pon: the triplet tile. */
  baseTile: TileId;
  /** The tile we claimed off the discarder. */
  called: TileId;
  /** Seat we called from. */
  from: Seat;
}

export interface PlayerState {
  /**
   * Concealed tiles only. With no calls this is 13 (or 14 when it's the
   * player's discard turn). After one open meld, this is 10 (or 11), etc.
   */
  hand: TileId[];
  /** Discarded pile (own discards). */
  discards: TileId[];
  /** Open melds claimed off other players. */
  melds: OpenMeld[];
  riichiDeclared: boolean;
  riichiTurn: number | null;
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
  scores: [number, number, number, number]; // running point totals across hands
  wall: Wall;
  active: Seat;
  dealer: Seat;
  roundWind: Wind;
  phase: Phase;
  turn: number; // total turns elapsed in this hand (each draw = +1)
  lastDrawn: TileId | null; // tile just drawn by active player
  lastDiscard: { tile: TileId; from: Seat } | null;
  result: RoundResult | null;
  /** 1-based East hand number (1..4). */
  handNumber: number;
  /** Honba (bonus-round) counter. Resets to 0 on non-renchan hand transitions. */
  honba: number;
  /** Riichi sticks waiting on the table for the next winner. */
  riichiSticks: number;
  /** True once the East round is fully complete (East 4 ended with no renchan). */
  roundComplete: boolean;
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
    melds: [],
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
    handNumber: 1,
    honba: 0,
    riichiSticks: 0,
    roundComplete: false,
  };
  return draw(state);
}

/**
 * Start the next hand of the current round. Returns null if the round is
 * already complete or the current hand hasn't ended yet.
 *
 *   - Non-renchan (non-dealer wins): dealer advances, handNumber +1, honba 0.
 *   - Renchan (dealer wins, or exhaustive draw with dealer tenpai — for v0.2
 *     we treat *any* draw as a renchan to keep it simple): dealer stays,
 *     handNumber unchanged, honba +1.
 *   - When handNumber would exceed 4, the round is marked complete instead.
 */
export function nextHand(state: GameState): GameState | null {
  if (state.phase !== "ended") return null;
  if (state.roundComplete) return null;

  const r = state.result;
  const dealerKept =
    r?.kind === "draw"
      ? true
      : r?.kind === "tsumo" || r?.kind === "ron"
        ? r.winner === state.dealer
        : true;

  const newHandNumber = dealerKept ? state.handNumber : state.handNumber + 1;
  const newHonba = dealerKept ? state.honba + 1 : 0;
  const newDealer = dealerKept ? state.dealer : (((state.dealer + 1) % 4) as Seat);

  if (newHandNumber > 4) {
    return { ...state, roundComplete: true };
  }

  const deal = dealHand();
  const players: PlayerState[] = deal.hands.map((h) => ({
    hand: sortTiles(h),
    discards: [],
    melds: [],
    riichiDeclared: false,
    riichiTurn: null,
    ippatsuActive: false,
  }));

  const next: GameState = {
    players: players as GameState["players"],
    scores: [...state.scores] as GameState["scores"],
    wall: deal.wall,
    active: newDealer,
    dealer: newDealer,
    roundWind: state.roundWind,
    phase: "awaiting-draw",
    turn: 0,
    lastDrawn: null,
    lastDiscard: null,
    result: null,
    handNumber: newHandNumber,
    honba: newHonba,
    riichiSticks: state.riichiSticks, // carry; winner collects on win
    roundComplete: false,
  };
  return draw(next);
}

// ── Pure transitions ──

function clone(state: GameState): GameState {
  return {
    players: state.players.map((p) => ({
      ...p,
      hand: [...p.hand],
      discards: [...p.discards],
      melds: p.melds.map((m) => ({ ...m })),
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
    handNumber: state.handNumber,
    honba: state.honba,
    riichiSticks: state.riichiSticks,
    roundComplete: state.roundComplete,
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

  // Resolve post-discard calls in priority order:
  //   1. Ron (any bot, with human-skip for priority).
  //   2. Pon (bots auto-call yakuhai).
  // The human's calls (ron / pon / chi) are surfaced via the UI window.
  const ronned = maybeBotRon(next);
  if (ronned) return ronned;
  const ponned = maybeBotPon(next);
  if (ponned) return ponned;
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
  // Riichi requires a closed hand.
  if (player.melds.length > 0) return null;

  // Build the post-discard concealed hand.
  const remaining = [...player.hand];
  remaining.splice(handIndex, 1);
  if (!isTenpai(remaining, player.melds.length)) return null;

  const next = clone(state);
  next.players[seat]!.riichiDeclared = true;
  next.players[seat]!.riichiTurn = state.turn;
  next.scores[seat] -= RIICHI_BET;
  next.riichiSticks += 1; // 1000pt stick goes onto the table
  // The discard is part of the riichi declaration.
  const afterDiscard = discard(next, handIndex);
  // Open the ippatsu window — set AFTER the discard so the discard's own
  // ippatsu-clearing branch doesn't immediately close it.
  afterDiscard.players[seat]!.ippatsuActive = true;
  return afterDiscard;
}

/** Try to declare tsumo on the just-drawn tile (any seat). */
export function declareTsumoFor(state: GameState, seat: Seat): GameState | null {
  if (state.phase !== "awaiting-discard") return null;
  if (state.active !== seat) return null;
  const player = state.players[seat]!;
  // Hand should be (14 - 3·meldCount) tiles at this point.
  const expectedHand = 14 - 3 * player.melds.length;
  if (player.hand.length !== expectedHand) return null;

  const winningTile = state.lastDrawn!;
  const ctx = {
    riichi: player.riichiDeclared,
    ippatsu: player.ippatsuActive,
    tsumo: true,
    roundWind: state.roundWind,
    seatWind: seatWind(seat, state.dealer),
    doraTiles: doraTiles(state),
    concealed: player.melds.length === 0,
  };
  const yaku = detectYaku(player.hand, winningTile, player.melds, ctx);
  if (!yaku || yaku.yaku.length === 0) return null;

  const shape = evaluateHand(player.hand, player.melds.length);
  if (!shape) return null;

  const score = scoreHand({
    shape,
    yakuResult: yaku,
    isDealer: seat === state.dealer,
    isTsumo: true,
  });

  const next = clone(state);
  applyTsumoTransfers(next, seat, score);
  // Honba: each non-winner pays an extra 100pt per honba stick.
  const honbaPerPayer = state.honba * 100;
  let honbaTotal = 0;
  for (let s = 0; s < 4; s++) {
    if (s !== seat) {
      next.scores[s] = next.scores[s]! - honbaPerPayer;
      next.scores[seat] += honbaPerPayer;
      honbaTotal += honbaPerPayer;
    }
  }
  // Riichi sticks: winner collects everything on the table.
  const sticksBonus = next.riichiSticks * 1000;
  next.scores[seat] += sticksBonus;
  next.riichiSticks = 0;

  next.phase = "ended";
  next.result = {
    kind: "tsumo",
    winner: seat,
    yakuNames: score.yakuNames,
    han: score.han,
    fu: score.fu,
    totalPoints: score.totalPoints + honbaTotal + sticksBonus,
    cap: score.cap,
  };
  return next;
}

/** Human helper (kept for back-compat with the UI). */
export function declareTsumo(state: GameState): GameState | null {
  return declareTsumoFor(state, HUMAN_SEAT);
}

/** Commit a ron declaration for the given seat against the last discard. */
export function commitRonFor(state: GameState, ronner: Seat): GameState | null {
  if (!state.lastDiscard) return null;
  const { tile, from } = state.lastDiscard;
  if (from === ronner) return null;

  const player = state.players[ronner]!;
  // Concealed hand should be (13 - 3·meldCount) tiles; the discard makes it
  // (14 - 3·meldCount) which is what the evaluator expects.
  const expectedConcealed = 13 - 3 * player.melds.length;
  if (player.hand.length !== expectedConcealed) return null;
  const winningHand = sortTiles([...player.hand, tile]);
  const shape = evaluateHand(winningHand, player.melds.length);
  if (!shape) return null;

  const ctx = {
    riichi: player.riichiDeclared,
    ippatsu: player.ippatsuActive,
    tsumo: false,
    roundWind: state.roundWind,
    seatWind: seatWind(ronner, state.dealer),
    doraTiles: doraTiles(state),
    concealed: player.melds.length === 0,
  };
  const yaku = detectYaku(winningHand, tile, player.melds, ctx);
  if (!yaku || yaku.yaku.length === 0) return null;

  const score = scoreHand({
    shape,
    yakuResult: yaku,
    isDealer: ronner === state.dealer,
    isTsumo: false,
  });

  const next = clone(state);
  next.scores[ronner] += score.totalPoints;
  next.scores[from] -= score.totalPoints;
  // Honba: loser pays an extra 300 per honba stick (entire honba bonus to winner).
  const honbaBonus = state.honba * 300;
  next.scores[ronner] += honbaBonus;
  next.scores[from] -= honbaBonus;
  // Riichi sticks
  const sticksBonus = next.riichiSticks * 1000;
  next.scores[ronner] += sticksBonus;
  next.riichiSticks = 0;

  next.phase = "ended";
  next.result = {
    kind: "ron",
    winner: ronner,
    loser: from,
    yakuNames: score.yakuNames,
    han: score.han,
    fu: score.fu,
    totalPoints: score.totalPoints + honbaBonus + sticksBonus,
    cap: score.cap,
  };
  return next;
}

/** Human helper (kept for back-compat with the UI). */
export function commitRon(state: GameState): GameState | null {
  return commitRonFor(state, HUMAN_SEAT);
}

// ── Open calls (pon / chi) ──

/** Can `seat` pon the tile that was just discarded? */
export function canPon(state: GameState, seat: Seat): boolean {
  if (state.phase !== "awaiting-draw") return false;
  if (!state.lastDiscard) return false;
  if (state.lastDiscard.from === seat) return false;
  // Riichi-declared players can't call.
  if (state.players[seat]!.riichiDeclared) return false;
  const tile = state.lastDiscard.tile;
  let count = 0;
  for (const t of state.players[seat]!.hand) {
    if (t === tile) count++;
  }
  return count >= 2;
}

/**
 * Can `seat` chi the tile that was just discarded? Chi is only available
 * to the player immediately after the discarder (and only on numbered tiles).
 * Returns the list of valid "base tiles" — the lowest tile of each possible
 * 3-run. Empty if no chi is possible.
 */
export function chiOptions(state: GameState, seat: Seat): TileId[] {
  if (state.phase !== "awaiting-draw") return [];
  if (!state.lastDiscard) return [];
  // Only next seat can chi.
  if ((state.lastDiscard.from + 1) % 4 !== seat) return [];
  if (state.players[seat]!.riichiDeclared) return [];
  const tile = state.lastDiscard.tile;
  if (isHonor(tile)) return [];
  const num = numberOf(tile);
  const counts = toCounts(state.players[seat]!.hand);
  const options: TileId[] = [];
  // Three possible runs containing `tile`: (tile-2, tile-1, tile),
  // (tile-1, tile, tile+1), (tile, tile+1, tile+2).
  // We need at least one of each "other" tile in hand.
  if (num >= 3 && (counts[tile - 2] ?? 0) > 0 && (counts[tile - 1] ?? 0) > 0) {
    options.push((tile - 2) as TileId);
  }
  if (num >= 2 && num <= 8 && (counts[tile - 1] ?? 0) > 0 && (counts[tile + 1] ?? 0) > 0) {
    options.push((tile - 1) as TileId);
  }
  if (num <= 7 && (counts[tile + 1] ?? 0) > 0 && (counts[tile + 2] ?? 0) > 0) {
    options.push(tile as TileId);
  }
  return options;
}

/**
 * Commit a pon call by `caller`. The caller claims the last-discarded tile
 * to form an open triplet, removes 2 matching tiles from their hand, and
 * becomes the active player on their discard step (no draw — the called
 * tile *is* the 14th).
 */
export function callPon(state: GameState, caller: Seat): GameState | null {
  if (!canPon(state, caller)) return null;
  const tile = state.lastDiscard!.tile;
  const from = state.lastDiscard!.from;

  const next = clone(state);
  // Remove 2 matching tiles from hand.
  let removed = 0;
  next.players[caller]!.hand = next.players[caller]!.hand.filter((t) => {
    if (removed < 2 && t === tile) {
      removed++;
      return false;
    }
    return true;
  });
  next.players[caller]!.melds.push({
    type: "pon",
    baseTile: tile,
    called: tile,
    from,
  });
  // The called tile is removed from the discarder's discard pile, since
  // it's been claimed and now belongs to the caller's open meld.
  const discardPile = next.players[from]!.discards;
  if (discardPile.length > 0 && discardPile[discardPile.length - 1] === tile) {
    discardPile.pop();
  }
  next.lastDiscard = null;
  // Calls break ippatsu for the riichi-declarer (if any).
  for (let s = 0; s < 4; s++) next.players[s]!.ippatsuActive = false;
  next.active = caller;
  next.phase = "awaiting-discard";
  next.lastDrawn = null;
  return next;
}

/**
 * Commit a chi call by `caller`. `baseTile` is the lowest tile of the run
 * (one of `chiOptions(state, caller)`). The called tile is whichever of the
 * 3-run it is (already in lastDiscard).
 */
export function callChi(state: GameState, caller: Seat, baseTile: TileId): GameState | null {
  const opts = chiOptions(state, caller);
  if (!opts.includes(baseTile)) return null;
  const calledTile = state.lastDiscard!.tile;
  const from = state.lastDiscard!.from;

  const next = clone(state);
  // Remove the 2 other tiles in the run from the caller's hand.
  const need = [baseTile, (baseTile + 1) as TileId, (baseTile + 2) as TileId].filter(
    (t) => t !== calledTile,
  );
  for (const t of need) {
    const idx = next.players[caller]!.hand.indexOf(t);
    if (idx === -1) return null;
    next.players[caller]!.hand.splice(idx, 1);
  }
  next.players[caller]!.melds.push({
    type: "chi",
    baseTile,
    called: calledTile,
    from,
  });
  const discardPile = next.players[from]!.discards;
  if (discardPile.length > 0 && discardPile[discardPile.length - 1] === calledTile) {
    discardPile.pop();
  }
  next.lastDiscard = null;
  for (let s = 0; s < 4; s++) next.players[s]!.ippatsuActive = false;
  next.active = caller;
  next.phase = "awaiting-discard";
  next.lastDrawn = null;
  return next;
}

/**
 * Bot-AI pon decision. Bots only pon yakuhai (a guaranteed 1-han yaku that
 * makes the open hand viable to win on). They never chi (positional and
 * usually weakens beginner-level play).
 */
function maybeBotPon(state: GameState): GameState | null {
  if (!state.lastDiscard) return null;
  const from = state.lastDiscard.from;
  const tile = state.lastDiscard.tile;
  if (!isHonor(tile)) return null; // only yakuhai-eligible (dragons + winds)
  // For winds: only call if it's the bot's round or seat wind.
  for (let off = 1; off <= 3; off++) {
    const seat = ((from + off) % 4) as Seat;
    if (seat === HUMAN_SEAT) continue;
    if (!canPon(state, seat)) continue;
    if (isDragon(tile)) {
      const result = callPon(state, seat);
      if (result) return result;
    } else if (isWind(tile)) {
      const w = (tile - 27) as Wind;
      const seatW = ((seat - state.dealer + 4) % 4) as Wind;
      if (w === state.roundWind || w === seatW) {
        const result = callPon(state, seat);
        if (result) return result;
      }
    }
  }
  return null;
}

/**
 * Resolve ron priority after a discard. Ron priority follows turn order
 * starting from the discarder's left (next seat to act). Bots auto-call when
 * they can; the human's call is driven from the UI, so we *stop* scanning
 * when we hit the human with a winning hand — otherwise a lower-priority
 * bot would steal the win the human would otherwise take.
 */
function maybeBotRon(state: GameState): GameState | null {
  if (!state.lastDiscard) return null;
  const from = state.lastDiscard.from;
  for (let off = 1; off <= 3; off++) {
    const seat = ((from + off) % 4) as Seat;
    if (seat === HUMAN_SEAT) {
      if (canDeclareRon(state)) return null;
      continue;
    }
    const result = commitRonFor(state, seat);
    if (result) return result;
  }
  return null;
}

/**
 * Bot turn: tsumo if winning, otherwise pick a discard. The bot was already
 * dealt a 14th tile by `draw()`.
 */
export function botDiscard(state: GameState): GameState {
  if (state.phase !== "awaiting-discard") return state;
  if (state.active === HUMAN_SEAT) return state; // not a bot
  const hand = state.players[state.active]!.hand;
  if (hand.length === 0) return state;

  // 1) Tsumo if the bot's hand is complete and yaku-bearing.
  const tsumoed = declareTsumoFor(state, state.active);
  if (tsumoed) return tsumoed;

  // 2) Otherwise discard. `discard()` will auto-ron for any bot that can
  //    claim the tile.
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
  // Riichi requires a fully closed hand.
  if (player.melds.length > 0) return false;
  // Tenpai check: at least one discard leaves a tenpai shape.
  for (let i = 0; i < player.hand.length; i++) {
    const remaining = [...player.hand];
    remaining.splice(i, 1);
    if (isTenpai(remaining, player.melds.length)) return true;
  }
  return false;
}

export function canDeclareTsumo(state: GameState): boolean {
  if (state.phase !== "awaiting-discard") return false;
  if (state.active !== HUMAN_SEAT) return false;
  const player = state.players[HUMAN_SEAT]!;
  const expectedHand = 14 - 3 * player.melds.length;
  if (player.hand.length !== expectedHand) return false;
  if (!evaluateHand(player.hand, player.melds.length)) return false;
  // Must have at least one yaku.
  const ctx = {
    riichi: player.riichiDeclared,
    ippatsu: player.ippatsuActive,
    tsumo: true,
    roundWind: state.roundWind,
    seatWind: seatWind(HUMAN_SEAT, state.dealer),
    doraTiles: doraTiles(state),
    concealed: player.melds.length === 0,
  };
  const yaku = detectYaku(player.hand, state.lastDrawn!, player.melds, ctx);
  return !!yaku && yaku.yaku.length > 0;
}

/**
 * Returns the set of tile ids that, if added to the human's current
 * concealed hand, would complete a winning shape. Empty if not tenpai.
 *
 * Caveat: only checks SHAPE completion — doesn't filter out yaku-less wins.
 */
export function humanWaits(state: GameState): TileId[] {
  const player = state.players[HUMAN_SEAT]!;
  const hand = player.hand;
  const meldCount = player.melds.length;
  const tenpaiSize = 13 - 3 * meldCount;
  const discardSize = 14 - 3 * meldCount;
  if (hand.length === tenpaiSize) return computeWaits(hand, meldCount);
  if (hand.length === discardSize) {
    const all = new Set<TileId>();
    for (let i = 0; i < hand.length; i++) {
      const remaining = [...hand];
      remaining.splice(i, 1);
      for (const w of computeWaits(remaining, meldCount)) all.add(w);
    }
    return [...all].sort((a, b) => a - b);
  }
  return [];
}

/**
 * For the human's discard step, return the set of hand indices that, when
 * discarded, leave a tenpai shape. Used to highlight legal discards in
 * riichi-arming mode.
 */
export function legalRiichiDiscardIndices(state: GameState): number[] {
  if (state.phase !== "awaiting-discard") return [];
  if (state.active !== HUMAN_SEAT) return [];
  const player = state.players[HUMAN_SEAT]!;
  const expected = 14 - 3 * player.melds.length;
  if (player.hand.length !== expected) return [];
  const out: number[] = [];
  for (let i = 0; i < player.hand.length; i++) {
    const remaining = [...player.hand];
    remaining.splice(i, 1);
    if (isTenpai(remaining, player.melds.length)) out.push(i);
  }
  return out;
}

export function canDeclareRon(state: GameState): boolean {
  if (state.phase !== "awaiting-draw") return false;
  if (!state.lastDiscard) return false;
  if (state.lastDiscard.from === HUMAN_SEAT) return false;
  const player = state.players[HUMAN_SEAT]!;
  const candidate = sortTiles([...player.hand, state.lastDiscard.tile]);
  if (!evaluateHand(candidate, player.melds.length)) return false;
  const ctx = {
    riichi: player.riichiDeclared,
    ippatsu: player.ippatsuActive,
    tsumo: false,
    roundWind: state.roundWind,
    seatWind: seatWind(HUMAN_SEAT, state.dealer),
    doraTiles: doraTiles(state),
    concealed: player.melds.length === 0,
  };
  const yaku = detectYaku(candidate, state.lastDiscard.tile, player.melds, ctx);
  return !!yaku && yaku.yaku.length > 0;
}
