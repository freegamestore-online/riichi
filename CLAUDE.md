# Grid Game Template

A free game on FreeGameStore.

- Subdomain: `riichi.freegamestore.online`
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Deploy: `git push origin main` (auto-deploys via Cloudflare Pages)

Free, MIT-licensed, no tracking. For platform conventions, read
https://raw.githubusercontent.com/freeappstore-online/freeappstore/main/SKILLS.md
before writing or changing anything.

---

## Template Purpose
This template is for building grid-based games such as:
- 2048
- Minesweeper
- Sudoku
- Wordle
- Connect Four
- Tic-Tac-Toe
- Match-3 puzzles

## Architecture
- `web/src/hooks/useGrid.ts` — Reusable grid state hook (rows, cols, cell operations)
- `web/src/hooks/useHighScore.ts` — localStorage-backed high score persistence
- `web/src/components/GameGrid.tsx` — Reusable CSS Grid renderer with touch + click support
- `web/src/App.tsx` — Demo match-3 game showing all features in action

## Grid Rendering
- Uses CSS Grid (not canvas) for accessibility and styling flexibility
- Responsive sizing via CSS clamp()
- Touch + click support on all cells
- Smooth CSS transitions (200ms ease for moves, 300ms scale for clears)
- CSS variables for theming (dark mode compatible)

## Visual Defaults
- Cells: rounded corners (0.5rem), subtle shadows, gradient fills
- Colors: vibrant but tasteful palette for cell values
- Score display with Fraunces font
- Glass-effect score panel
- Dark mode via prefers-color-scheme (no toggle)