import { describe, expect, it } from "vitest";
import { evaluateHand, isTenpai, waits } from "./evaluator";
import { parseHand } from "./tiles";

describe("evaluator: kokushi musou", () => {
  it("recognises a kokushi hand with East pair", () => {
    // 1m 9m 1p 9p 1s 9s + E S W N White Green Red + extra East
    const tiles = parseHand("19m19p19s11234z567z");
    const result = evaluateHand(tiles);
    expect(result?.kind).toBe("kokushi");
    if (result?.kind === "kokushi") {
      expect(result.head).toBe(27); // East
    }
  });

  it("rejects missing terminal", () => {
    // Missing 9s — should not be kokushi
    const tiles = parseHand("19m19p1s1234z1567z");
    expect(evaluateHand(tiles)?.kind).not.toBe("kokushi");
  });
});

describe("evaluator: chiitoitsu", () => {
  it("recognises seven pairs", () => {
    const tiles = parseHand("1122m3344p5566s11z");
    const result = evaluateHand(tiles);
    expect(result?.kind).toBe("chiitoitsu");
    if (result?.kind === "chiitoitsu") {
      expect(result.pairs.length).toBe(7);
    }
  });

  it("recognises a fully-paired 14-tile hand as chiitoitsu", () => {
    const tiles = parseHand("1122m3344p556677s");
    expect(evaluateHand(tiles)?.kind).toBe("chiitoitsu");
  });
});

describe("evaluator: standard 4 melds + pair", () => {
  it("recognises four chis + a pair", () => {
    // 123m 456m 789p 123s + 5s pair
    const tiles = parseHand("123456789m123p55s23s1m");
    // Simpler: 123m 456m 789p 123s 55s = 14 tiles? 3+3+3+3+2 = 14 ✓
    const clean = parseHand("123456m789p123s55s");
    expect(clean.length).toBe(14);
    const result = evaluateHand(clean);
    expect(result?.kind).toBe("standard");
    if (result?.kind === "standard") {
      expect(result.melds.length).toBe(4);
      expect(result.pair).toBe(18 + 5 - 1); // 5s = id 22
    }
    void tiles;
  });

  it("recognises four pons + a pair", () => {
    // 111m 222m 333p 444s EE
    const tiles = parseHand("111222m333p444s11z");
    expect(tiles.length).toBe(14);
    const result = evaluateHand(tiles);
    expect(result?.kind).toBe("standard");
    if (result?.kind === "standard") {
      const pons = result.melds.filter((m) => m.type === "pon").length;
      expect(pons).toBe(4);
    }
  });

  it("recognises a mix of chis and pons", () => {
    // 123m 456m 789p 111s EE
    const tiles = parseHand("123456m789p111s11z");
    expect(tiles.length).toBe(14);
    const result = evaluateHand(tiles);
    expect(result?.kind).toBe("standard");
    if (result?.kind === "standard") {
      const chis = result.melds.filter((m) => m.type === "chi").length;
      const pons = result.melds.filter((m) => m.type === "pon").length;
      expect(chis).toBe(3);
      expect(pons).toBe(1);
    }
  });

  it("rejects an incomplete hand", () => {
    // 14 tiles with leftover singletons that cannot complete any meld.
    const tiles = parseHand("1122m345m1234567p");
    expect(tiles.length).toBe(14);
    expect(evaluateHand(tiles)).toBeNull();
  });

  it("rejects a hand with no pair available", () => {
    // 14 distinct tiles — every count is 1, so no pair can be extracted.
    const tiles = parseHand("123456789m12345p");
    expect(tiles.length).toBe(14);
    expect(evaluateHand(tiles)).toBeNull();
  });
});

describe("evaluator: tenpai + waits", () => {
  it("detects tenpai when one tile completes the hand", () => {
    // 123m 456m 789p 123s + 5s (waiting for 5s)
    const tiles = parseHand("123456m789p123s5s");
    expect(tiles.length).toBe(13);
    expect(isTenpai(tiles)).toBe(true);
  });

  it("returns the wait list for a single-wait hand", () => {
    // 123m 456m 789p 123s + 5s → waiting on 5s only (tanki single-tile wait)
    const tiles = parseHand("123456m789p123s5s");
    const w = waits(tiles);
    expect(w).toEqual([18 + 5 - 1]); // 5s = id 22
  });

  it("detects a two-sided wait (ryanmen)", () => {
    // 234m 456m 789p 123s + 11z — wait actually the pair is 11z and the
    // tenpai shape needs one missing tile. Build: 123m 456m 789p 12s 11z
    // → waiting on 3s OR — wait, 12s needs 3s only to complete. Two-sided
    // wait: 23s could complete with 1s or 4s.
    // Build: 123m 456m 789p 23s 11z (13 tiles), waits on 1s or 4s.
    const tiles = parseHand("123456m789p23s11z");
    expect(tiles.length).toBe(13);
    expect(isTenpai(tiles)).toBe(true);
    const w = waits(tiles).sort((a, b) => a - b);
    expect(w).toEqual([18, 21]); // 1s, 4s
  });
});
