# Riichi

4-player Riichi Mahjong (Japanese rules) on FreeGameStore. v0.2 is single-player vs three random-discard bots; multiplayer over FGS rooms is planned for v0.3+.

- Subdomain: `riichi.freegamestore.online`
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Test: `pnpm --filter @riichi/web test`
- Deploy: `git push origin main` (auto-deploys via Cloudflare Pages)

The game engine lives in `web/src/engine/` and is pure TypeScript (no React, no DOM):
`tiles.ts` (34-type Unicode tile system + parser), `wall.ts` (deal + dora),
`evaluator.ts` (4-melds-and-pair / chiitoitsu / kokushi decomposer), `yaku.ts`
(yaku subset detector), `score.ts` (fu + han + transfers), `game.ts` (state
machine consumed by the UI).

Free, MIT-licensed, no tracking. For platform conventions read
https://raw.githubusercontent.com/freegamestore-online/freegamestore/main/SKILLS.md
before writing or changing anything.

Sibling solitaire-style game with the same tile artwork:
[`mahjong.freegamestore.online`](https://mahjong.freegamestore.online).
