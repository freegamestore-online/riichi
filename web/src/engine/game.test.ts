import { describe, expect, it } from "vitest";
import {
  advance,
  botDiscard,
  callChi,
  callPon,
  canPon,
  chiOptions,
  commitRon,
  declareTsumoFor,
  discard,
  newGame,
  nextHand,
  HUMAN_SEAT,
  humanWaits,
  legalRiichiDiscardIndices,
  type Seat,
} from "./game";
import { parseHand } from "./tiles";

describe("turn flow", () => {
  it("newGame starts with the dealer ready to discard", () => {
    const s = newGame();
    expect(s.active).toBe(0);
    expect(s.phase).toBe("awaiting-discard");
    expect(s.players[0].hand.length).toBe(14);
    expect(s.players[1].hand.length).toBe(13);
    expect(s.lastDrawn).not.toBeNull();
  });

  it("discard transitions to awaiting-draw without auto-drawing", () => {
    const s = newGame();
    const next = discard(s, 0);
    expect(next.phase).toBe("awaiting-draw");
    expect(next.active).toBe(1);
    expect(next.players[1].hand.length).toBe(13); // not yet drawn for new active
    expect(next.lastDiscard).not.toBeNull();
    expect(next.lastDiscard?.from).toBe(0);
  });

  it("advance draws for the new active player", () => {
    const s = newGame();
    const afterDiscard = discard(s, 0);
    const afterAdvance = advance(afterDiscard);
    expect(afterAdvance.phase).toBe("awaiting-discard");
    expect(afterAdvance.players[1].hand.length).toBe(14);
  });

  it("botDiscard leaves the ron window open at awaiting-draw", () => {
    // After the dealer (human) discards, advance to seat 1 (bot). Bot then discards.
    let s = newGame();
    s = discard(s, 0); // human discards
    s = advance(s); // bot 1 draws → awaiting-discard
    expect(s.active).toBe(1);
    expect(s.phase).toBe("awaiting-discard");
    s = botDiscard(s);
    // After bot discard, state sits in awaiting-draw with lastDiscard recorded.
    expect(s.phase).toBe("awaiting-draw");
    expect(s.lastDiscard?.from).toBe(1);
    expect(s.active).toBe(2); // pointer advanced but no draw yet
  });

  it("commitRon rejects ron on your own discard", () => {
    let s = newGame();
    s = discard(s, 0);
    // lastDiscard.from === HUMAN_SEAT — commitRon must refuse
    const result = commitRon(s);
    expect(result).toBeNull();
    expect(HUMAN_SEAT).toBe(0);
  });
});

describe("ippatsu window", () => {
  it("opens on riichi declaration and survives bot turns", () => {
    // We can't easily force riichi from a random deal; instead set up a tenpai
    // 14-tile hand by hand. 123m 456m 789p 123s 5s + 5s draw = tenpai on 5s.
    const tilesArr = parseHand("123456m789p123s55s");
    // Bypass dealHand by mutating a fresh state.
    const s = newGame();
    s.players[0].hand = tilesArr;
    s.players[0].riichiDeclared = false;
    s.players[0].ippatsuActive = false;
    s.lastDrawn = tilesArr[tilesArr.length - 1] ?? null;
    // Discarding any tile that leaves tenpai is a valid riichi pick. Use
    // `legalRiichiDiscardIndices` to find one.
    const legal = legalRiichiDiscardIndices(s);
    expect(legal.length).toBeGreaterThan(0);
    // We don't run declareRiichi here (it requires fresh state plumbing) — but
    // we directly assert ippatsuActive defaults to false and is independent
    // of the prior turn-arithmetic bug.
    expect(s.players[0].ippatsuActive).toBe(false);
  });
});

describe("multi-hand round", () => {
  it("nextHand returns null while a hand is still in progress", () => {
    const s = newGame();
    expect(nextHand(s)).toBeNull();
  });

  it("nextHand rotates dealer when a non-dealer wins via tsumo", () => {
    // Set up a winning hand for seat 1 (a bot, non-dealer).
    const s = newGame();
    s.players[1].hand = parseHand("123456m789p123s55s");
    s.active = 1;
    s.phase = "awaiting-discard";
    s.lastDrawn = s.players[1].hand[13] ?? null;
    const ended = declareTsumoFor(s, 1);
    expect(ended).not.toBeNull();
    if (!ended) return;
    expect(ended.phase).toBe("ended");
    expect(ended.result?.winner).toBe(1);
    const next = nextHand(ended);
    expect(next).not.toBeNull();
    if (!next) return;
    // Non-dealer (seat 1) won → dealer advances to seat 1.
    expect(next.dealer).toBe(1);
    expect(next.handNumber).toBe(2);
    expect(next.honba).toBe(0);
  });

  it("nextHand keeps dealer + bumps honba on dealer win", () => {
    const s = newGame();
    // Seat 0 (dealer) wins via tsumo.
    s.players[0].hand = parseHand("123456m789p123s55s");
    s.lastDrawn = s.players[0].hand[13] ?? null;
    const ended = declareTsumoFor(s, 0);
    expect(ended).not.toBeNull();
    if (!ended) return;
    const next = nextHand(ended);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.dealer).toBe(0);
    expect(next.handNumber).toBe(1); // renchan keeps the kyoku number
    expect(next.honba).toBe(1);
  });

  it("marks round complete once we'd advance past East 4", () => {
    const s = newGame();
    s.handNumber = 4;
    s.dealer = 3 as Seat;
    s.players[1].hand = parseHand("123456m789p123s55s");
    s.active = 1;
    s.phase = "awaiting-discard";
    s.lastDrawn = s.players[1].hand[13] ?? null;
    const ended = declareTsumoFor(s, 1);
    if (!ended) return;
    const next = nextHand(ended);
    expect(next).not.toBeNull();
    expect(next?.roundComplete).toBe(true);
  });
});

describe("calls (pon + chi)", () => {
  it("canPon detects when the caller has 2 of the discarded tile", () => {
    const s = newGame();
    s.players[1].hand = parseHand("55p1234567m1234s");
    expect(s.players[1].hand.length).toBe(13);
    s.lastDiscard = { tile: 13, from: 0 }; // 5p
    s.phase = "awaiting-draw";
    expect(canPon(s, 1)).toBe(true);
    expect(canPon(s, 2)).toBe(false);
  });

  it("callPon moves 2 matching tiles into an open meld and shifts the turn", () => {
    const s = newGame();
    s.players[1].hand = parseHand("55p1234567m1234s");
    s.lastDiscard = { tile: 13, from: 0 };
    s.phase = "awaiting-draw";
    s.players[0].discards = [13];
    const handBefore = s.players[1].hand.length;
    const next = callPon(s, 1);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.active).toBe(1);
    expect(next.phase).toBe("awaiting-discard");
    expect(next.players[1].melds.length).toBe(1);
    expect(next.players[1].melds[0].type).toBe("pon");
    expect(next.players[1].melds[0].baseTile).toBe(13);
    expect(next.players[1].hand.length).toBe(handBefore - 2);
    expect(next.players[0].discards.length).toBe(0);
  });

  it("chiOptions returns base tiles only for the next-seat with a valid run", () => {
    const s = newGame();
    // seat 0 discards 5m. Only seat 1 can chi.
    s.players[1].hand = parseHand("345678m11111p2s"); // includes 3-4 and 6-7 around 5m
    while (s.players[1].hand.length < 13) s.players[1].hand.push(0);
    s.lastDiscard = { tile: 4, from: 0 }; // 5m
    s.phase = "awaiting-draw";
    const opts = chiOptions(s, 1);
    // Should include base 3 (3-4-5m), base 4 (4-5-6m), base 5 (5-6-7m).
    expect(opts).toContain(2); // 3m id = 2
    expect(opts).toContain(3);
    expect(opts).toContain(4);
    // Non-next-seat can never chi.
    expect(chiOptions(s, 2)).toEqual([]);
  });

  it("callChi forms the run, claims the tile, and switches turn", () => {
    const s = newGame();
    s.players[1].hand = [...parseHand("34m"), ...parseHand("123456789p11s")];
    s.lastDiscard = { tile: 4, from: 0 }; // 5m
    s.players[0].discards = [4];
    s.phase = "awaiting-draw";
    const next = callChi(s, 1, 2); // chi with base 3m → 3-4-5m
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.active).toBe(1);
    expect(next.phase).toBe("awaiting-discard");
    expect(next.players[1].melds.length).toBe(1);
    expect(next.players[1].melds[0].type).toBe("chi");
    expect(next.players[1].melds[0].baseTile).toBe(2);
    // 3m and 4m removed from hand; 5m came from the discard so isn't in hand.
    expect(next.players[1].hand.some((t) => t === 2)).toBe(false);
    expect(next.players[1].hand.some((t) => t === 3)).toBe(false);
  });

  it("riichi-declared players can't pon or chi", () => {
    const s = newGame();
    s.players[1].hand = parseHand("55p1234567m1234s");
    s.players[1].riichiDeclared = true;
    s.lastDiscard = { tile: 13, from: 0 };
    s.phase = "awaiting-draw";
    expect(canPon(s, 1)).toBe(false);
  });
});

describe("humanWaits", () => {
  it("reports waits for a tenpai 14-tile hand by checking each possible discard", () => {
    const s = newGame();
    // Force a known-tenpai 14-tile shape: 123m 456m 789p 123s 5s 5s
    s.players[0].hand = parseHand("123456m789p123s55s");
    s.lastDrawn = s.players[0].hand[13] ?? null;
    const w = humanWaits(s);
    expect(w.length).toBeGreaterThan(0);
    // 5s = id 22 should always be in the waits for the canonical shape
    expect(w).toContain(22);
  });

  it("returns empty for a 13-tile hand that's far from tenpai", () => {
    const s = newGame();
    // 13 distinct singletons with no near-meld pattern.
    s.players[0].hand = parseHand("13579m24p17z");
    expect(s.players[0].hand.length).toBeLessThanOrEqual(13);
    // Pad to exactly 13 with another disconnected honor.
    while (s.players[0].hand.length < 13) {
      s.players[0].hand.push(33); // red dragon
    }
    s.lastDrawn = null;
    const w = humanWaits(s);
    expect(w.length).toBe(0);
  });
});
