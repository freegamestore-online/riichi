import { useState, useCallback } from "react";

function createGrid<T>(rows: number, cols: number, init: () => T): T[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => init())
  );
}

export function useGrid<T>(rows: number, cols: number, init: () => T) {
  const [grid, setGrid] = useState<T[][]>(() => createGrid(rows, cols, init));

  const setCell = useCallback((r: number, c: number, value: T) => {
    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      next[r]![c] = value;
      return next;
    });
  }, []);

  const resetGrid = useCallback(() => {
    setGrid(createGrid(rows, cols, init));
  }, [rows, cols, init]);

  const forEachCell = useCallback(
    (fn: (value: T, r: number, c: number) => void) => {
      grid.forEach((row, r) => row.forEach((value, c) => fn(value, r, c)));
    },
    [grid]
  );

  return { grid, setGrid, setCell, resetGrid, forEachCell };
}
