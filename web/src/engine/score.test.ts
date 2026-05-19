import { describe, expect, it } from "vitest";
import { evaluateHand } from "./evaluator";
import { scoreHand } from "./score";
import { parseHand } from "./tiles";
import { detectYaku } from "./yaku";

describe("scoring: integration", () => {
  it("scores a closed riichi + tsumo tanyao hand from a non-dealer", () => {
    // 234m 567m 234p 567p + 5s5s pair, drew 5s last (tsumo, tanyao — no terminals/honors)
    const tiles = parseHand("234567m234567p55s");
    expect(tiles.length).toBe(14);
    const winningTile = 22; // 5s
    const shape = evaluateHand(tiles);
    expect(shape).not.toBeNull();
    if (!shape) return;
    const yaku = detectYaku(tiles, winningTile, [], {
      riichi: true,
      ippatsu: false,
      tsumo: true,
      roundWind: 0,
      seatWind: 1, // not East — non-dealer
      doraTiles: [],
      concealed: true,
    });
    expect(yaku).not.toBeNull();
    if (!yaku) return;
    // Expected yaku: Riichi, Menzen Tsumo, Pinfu, Tanyao, Iipeikou (two 234s + two 567s? no, 234m & 234p are different suits) → no iipeikou
    // Riichi(1) + Menzen Tsumo(1) + Pinfu(1) + Tanyao(1) = 4 han
    const names = yaku.yaku.map((y) => y.name);
    expect(names).toContain("Riichi");
    expect(names).toContain("Menzen Tsumo");
    expect(names).toContain("Tanyao");
    expect(names).toContain("Pinfu");
    expect(yaku.totalHan).toBeGreaterThanOrEqual(4);

    const result = scoreHand({
      shape,
      yakuResult: yaku,
      isDealer: false,
      isTsumo: true,
    });
    // Non-dealer tsumo at 4 han / 30 fu = 1000 from each non-dealer, 2000 from dealer
    // Total = 1000 + 1000 + 2000 = 4000 (with rounding-up-to-100 applied per payer)
    expect(result.totalPoints).toBeGreaterThan(0);
    expect(result.han).toBe(yaku.totalHan);
  });

  it("scores chiitoitsu at 25 fu", () => {
    const tiles = parseHand("1122m3344p556677s");
    const shape = evaluateHand(tiles);
    expect(shape?.kind).toBe("chiitoitsu");
    if (!shape) return;
    const yaku = detectYaku(tiles, 18, [], {
      riichi: false,
      ippatsu: false,
      tsumo: true,
      roundWind: 0,
      seatWind: 0,
      doraTiles: [],
      concealed: true,
    });
    expect(yaku?.yaku.some((y) => y.name === "Chiitoitsu")).toBe(true);
    if (!yaku) return;

    const result = scoreHand({
      shape,
      yakuResult: yaku,
      isDealer: false,
      isTsumo: true,
    });
    expect(result.fu).toBe(25);
  });

  it("caps yakuman at the Yakuman base (8000)", () => {
    const tiles = parseHand("19m19p19s11234z567z");
    const shape = evaluateHand(tiles);
    expect(shape?.kind).toBe("kokushi");
    if (!shape) return;
    const yaku = detectYaku(tiles, 27, [], {
      riichi: false,
      ippatsu: false,
      tsumo: true,
      roundWind: 0,
      seatWind: 0,
      doraTiles: [],
      concealed: true,
    });
    expect(yaku?.totalHan).toBeGreaterThanOrEqual(13);
    if (!yaku) return;

    const result = scoreHand({
      shape,
      yakuResult: yaku,
      isDealer: false,
      isTsumo: true,
    });
    expect(result.cap).toBe("Yakuman");
    // Non-dealer yakuman tsumo: dealer pays 16000, others pay 8000 each → 32000 total
    expect(result.totalPoints).toBe(32000);
  });

  it("dealer ron at mangan pays 12000", () => {
    // Just check the cap logic mechanically. 5 han, dealer, ron.
    const tiles = parseHand("234567m234567p55s");
    const shape = evaluateHand(tiles);
    if (!shape) return;
    const yaku = {
      yaku: [
        { name: "A", han: 2 },
        { name: "B", han: 3 },
      ],
      doraCount: 0,
      totalHan: 5,
    };
    const result = scoreHand({
      shape,
      yakuResult: yaku,
      isDealer: true,
      isTsumo: false,
    });
    expect(result.cap).toBe("Mangan");
    expect(result.totalPoints).toBe(12000);
  });
});
