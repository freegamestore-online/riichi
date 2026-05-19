import type { ReactNode } from "react";

interface Props<T> {
  grid: T[][];
  renderCell: (value: T, row: number, col: number) => ReactNode;
  onCellClick?: (row: number, col: number) => void;
  cellSize?: string;
  gap?: string;
}

export function GameGrid<T>({
  grid,
  renderCell,
  onCellClick,
  cellSize = "clamp(3rem, 12vmin, 5rem)",
  gap = "0.4rem",
}: Props<T>) {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  return (
    <div
      className="grid-game"
      style={{
        display: "grid",
        gridTemplateRows: `repeat(${rows}, ${cellSize})`,
        gridTemplateColumns: `repeat(${cols}, ${cellSize})`,
        gap,
        justifyContent: "center",
        touchAction: "manipulation",
      }}
    >
      {grid.map((row, r) =>
        row.map((value, c) => (
          <div
            key={`${r}-${c}`}
            onClick={() => onCellClick?.(r, c)}
            onTouchEnd={(e) => {
              e.preventDefault();
              onCellClick?.(r, c);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "0.5rem",
              cursor: onCellClick ? "pointer" : "default",
              transition: "transform 200ms ease, opacity 300ms ease",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            {renderCell(value, r, c)}
          </div>
        ))
      )}
    </div>
  );
}
