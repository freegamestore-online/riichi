import { useState, useCallback } from "react";

export function useHighScore(key: string) {
  const [highScore, setHighScore] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? Number(stored) : 0;
    } catch {
      return 0;
    }
  });

  const updateHighScore = useCallback(
    (score: number) => {
      if (score > highScore) {
        setHighScore(score);
        try {
          localStorage.setItem(key, String(score));
        } catch {
          // localStorage unavailable
        }
      }
    },
    [key, highScore]
  );

  return { highScore, updateHighScore };
}
