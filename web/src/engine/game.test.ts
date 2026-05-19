import { describe, expect, it } from "vitest";
import { advance, botDiscard, commitRon, discard, newGame, HUMAN_SEAT } from "./game";

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
