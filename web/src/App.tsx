import { GameAuth, GameShell, GameTopbar } from "@freegamestore/games";
import { Board } from "./components/Board";

export default function App() {
  return (
    <GameShell
      topbar={
        <GameTopbar
          title="Riichi"
          actions={<GameAuth />}
          rules={
            <div>
              <h3 style={{ fontWeight: 700 }}>Riichi Mahjong</h3>
              <h4 style={{ fontWeight: 600 }}>v0.2 — single-player vs bots</h4>
              <p>
                A simplified Japanese-rules Riichi demo. You play the East seat
                against three random-discard bots over a single hand.
              </p>
              <h4 style={{ fontWeight: 600 }}>What works</h4>
              <ul>
                <li>Wall, deal, one dora indicator</li>
                <li>Draw + discard for all four players</li>
                <li>Riichi declaration when you reach tenpai (1 away)</li>
                <li>Tsumo on self-draw, Ron on a bot's discard</li>
                <li>
                  Subset of yaku: Riichi, Ippatsu, Menzen Tsumo, Pinfu, Tanyao,
                  Yakuhai (round/seat winds + dragons), Iipeikou, Toitoi,
                  Honitsu, Chinitsu, Chiitoitsu, Kokushi
                </li>
                <li>Naive 30/25 fu scoring with mangan/haneman/baiman caps</li>
              </ul>
              <h4 style={{ fontWeight: 600 }}>What's missing (v0.2 cuts)</h4>
              <ul>
                <li>Calling chi/pon/kan — no open melds</li>
                <li>Bots don't call, riichi, or tsumo</li>
                <li>Full fu calculation (always 30, or 25 for chiitoitsu)</li>
                <li>Two-sided wait check for pinfu</li>
                <li>Multi-hand round + honba tracking</li>
                <li>Rare yaku (sanshoku, ittsuu, chanta, haitei…)</li>
                <li>Multiplayer over FGS rooms</li>
              </ul>
              <p style={{ marginTop: "1rem", fontSize: "0.85em", opacity: 0.7 }}>
                For solitaire tile-matching, see{" "}
                <a href="https://mahjong.freegamestore.online">
                  mahjong.freegamestore.online
                </a>
                .
              </p>
            </div>
          }
        />
      }
    >
      <Board />
    </GameShell>
  );
}
