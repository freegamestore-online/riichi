import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useGameSounds } from "@freegamestore/games";
import {
  type GameState,
  HUMAN_SEAT,
  type Seat,
  botDiscard,
  canDeclareRiichi,
  canDeclareRon,
  canDeclareTsumo,
  commitRon,
  declareRiichi,
  declareTsumo,
  discard,
  newGame,
} from "../engine/game";
import { glyph, type TileId } from "../engine/tiles";
import { tilesRemaining } from "../engine/wall";

const SEAT_LABELS: Record<Seat, string> = { 0: "You", 1: "Right", 2: "Across", 3: "Left" };
const SEAT_WIND: Record<Seat, string> = { 0: "E", 1: "S", 2: "W", 3: "N" };

type Action =
  | { type: "new-game" }
  | { type: "discard"; handIndex: number }
  | { type: "riichi"; handIndex: number }
  | { type: "tsumo" }
  | { type: "ron" }
  | { type: "bot-step" };

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "new-game":
      return newGame();
    case "discard":
      return discard(state, action.handIndex);
    case "riichi": {
      const next = declareRiichi(state, action.handIndex);
      return next ?? state;
    }
    case "tsumo": {
      const next = declareTsumo(state);
      return next ?? state;
    }
    case "ron": {
      const next = commitRon(state);
      return next ?? state;
    }
    case "bot-step":
      return botDiscard(state);
  }
}

export function Board() {
  const [state, dispatch] = useReducer(reducer, undefined, newGame);
  const [riichiMode, setRiichiMode] = useState(false);
  const lastDiscardRef = useRef<HTMLDivElement | null>(null);
  const sounds = useGameSounds();
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;
  const endedRef = useRef(false);

  // Bot turns advance automatically.
  useEffect(() => {
    if (state.phase === "ended") return;
    if (state.active === HUMAN_SEAT) return;
    if (state.phase !== "awaiting-discard") return;
    const t = setTimeout(() => {
      soundsRef.current.playTick();
      dispatch({ type: "bot-step" });
    }, 700);
    return () => clearTimeout(t);
  }, [state.active, state.phase]);

  // Fire end-of-hand sounds when the result resolves.
  useEffect(() => {
    if (state.phase === "ended" && !endedRef.current) {
      endedRef.current = true;
      const kind = state.result?.kind;
      if (kind === "tsumo" || kind === "ron") {
        soundsRef.current.playClear();
      } else if (kind === "draw") {
        soundsRef.current.playGameOver();
      }
    } else if (state.phase !== "ended") {
      endedRef.current = false;
    }
  }, [state.phase, state.result]);

  const onTileClick = useCallback(
    (handIndex: number) => {
      if (state.active !== HUMAN_SEAT) return;
      if (state.phase !== "awaiting-discard") return;
      if (riichiMode) {
        const next = declareRiichi(state, handIndex);
        if (next) {
          soundsRef.current.playTick();
          dispatch({ type: "riichi", handIndex });
          setRiichiMode(false);
        }
        return;
      }
      soundsRef.current.playTick();
      dispatch({ type: "discard", handIndex });
    },
    [state, riichiMode],
  );

  const onTsumo = () => {
    soundsRef.current.playTick();
    dispatch({ type: "tsumo" });
  };
  const onRon = () => {
    soundsRef.current.playTick();
    dispatch({ type: "ron" });
  };
  const onRiichi = () => {
    soundsRef.current.playTick();
    setRiichiMode((m) => !m);
  };
  const onNewHand = () => {
    setRiichiMode(false);
    dispatch({ type: "new-game" });
  };

  const human = state.players[HUMAN_SEAT];
  const canTsumo = canDeclareTsumo(state);
  const canRon = canDeclareRon(state);
  const canRiichi = canDeclareRiichi(state) && !state.players[HUMAN_SEAT].riichiDeclared;
  const wallLeft = tilesRemaining(state.wall);

  return (
    <div className="relative w-full h-full" style={{ background: "#0e3b21" }}>
      {/* Opponents: top, left, right */}
      <OpponentRow seat={2} state={state} position="top" />
      <OpponentRow seat={3} state={state} position="left" />
      <OpponentRow seat={1} state={state} position="right" />

      {/* Center: discard piles + wall count */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative" style={{ width: 360, height: 360 }}>
          <DiscardPile seat={0} state={state} position="bottom" />
          <DiscardPile seat={1} state={state} position="right" />
          <DiscardPile seat={2} state={state} position="top" />
          <DiscardPile seat={3} state={state} position="left" />
          <div
            ref={lastDiscardRef}
            className="absolute inset-0 flex items-center justify-center text-sm"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            <div className="text-center">
              <div style={{ fontSize: 14, opacity: 0.7 }}>{wallLeft} left</div>
              <div style={{ fontSize: 12, opacity: 0.5 }}>
                Round {SEAT_WIND[state.roundWind]} · Turn {state.turn}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Human hand */}
      <div className="absolute left-0 right-0 bottom-2 flex flex-col items-center gap-2">
        <div className="flex gap-1 flex-wrap justify-center px-2">
          {human.hand.map((t, i) => (
            <Tile
              key={`${t}-${i}`}
              tile={t}
              size="lg"
              highlight={riichiMode}
              recent={i === human.hand.length - 1 && state.lastDrawn !== null}
              onClick={() => onTileClick(i)}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 px-3 py-2">
          {canRiichi && (
            <Button onClick={onRiichi} variant={riichiMode ? "danger" : "primary"}>
              {riichiMode ? "Cancel riichi" : "Riichi"}
            </Button>
          )}
          {canTsumo && (
            <Button onClick={onTsumo} variant="success">
              Tsumo
            </Button>
          )}
          {canRon && (
            <Button onClick={onRon} variant="success">
              Ron
            </Button>
          )}
          <div className="text-xs text-white/70 px-2">
            {state.players[HUMAN_SEAT].riichiDeclared && (
              <span className="px-2 py-1 rounded bg-yellow-600 text-white text-xs font-bold mr-2">
                RIICHI
              </span>
            )}
            Score: <strong className="text-white">{state.scores[HUMAN_SEAT]}</strong>
          </div>
        </div>
      </div>

      {state.phase === "ended" && state.result && (
        <ResultModal result={state.result} state={state} onNewHand={onNewHand} />
      )}
    </div>
  );
}

// ── Tile component ──

interface TileProps {
  tile: TileId;
  size: "sm" | "md" | "lg";
  highlight?: boolean;
  recent?: boolean;
  onClick?: () => void;
  rotation?: 0 | 90 | 180 | 270;
}

function Tile({ tile, size, highlight, recent, onClick, rotation = 0 }: TileProps) {
  const dims =
    size === "lg"
      ? { w: 38, h: 50, font: 28 }
      : size === "md"
        ? { w: 28, h: 36, font: 20 }
        : { w: 20, h: 26, font: 14 };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="tile-face"
      style={{
        width: dims.w,
        height: dims.h,
        fontSize: dims.font,
        color: "#1a1a1a",
        cursor: onClick ? "pointer" : "default",
        outline: highlight ? "2px solid #f59e0b" : undefined,
        transform: `rotate(${rotation}deg)${recent ? " translateY(-3px)" : ""}`,
        transition: "transform 0.1s",
        padding: 0,
      }}
    >
      <span style={{ pointerEvents: "none" }}>{glyph(tile)}</span>
    </button>
  );
}

function TileBack({ size, rotation = 0 }: { size: "sm" | "md"; rotation?: number }) {
  const dims = size === "md" ? { w: 24, h: 32 } : { w: 18, h: 24 };
  return (
    <div
      className="tile-back"
      style={{
        width: dims.w,
        height: dims.h,
        transform: `rotate(${rotation}deg)`,
      }}
    />
  );
}

// ── Opponents ──

function OpponentRow({
  seat,
  state,
  position,
}: {
  seat: Seat;
  state: GameState;
  position: "top" | "left" | "right";
}) {
  const player = state.players[seat];
  const isActive = state.active === seat && state.phase !== "ended";
  const containerStyle: React.CSSProperties =
    position === "top"
      ? { top: 6, left: 0, right: 0, flexDirection: "column", alignItems: "center" }
      : position === "left"
        ? { left: 6, top: 0, bottom: 0, flexDirection: "column", justifyContent: "center" }
        : { right: 6, top: 0, bottom: 0, flexDirection: "column", justifyContent: "center" };

  const tileRotation = position === "top" ? 180 : position === "left" ? 90 : 270;
  const tileLayout = position === "top" ? "flex" : "flex flex-col";

  return (
    <div className="absolute flex gap-2" style={containerStyle}>
      <div className={`${tileLayout} gap-1`}>
        {player.hand.map((_, i) => (
          <TileBack key={i} size="sm" rotation={tileRotation} />
        ))}
      </div>
      <div
        className="text-xs px-2 py-1 rounded"
        style={{
          background: isActive ? "rgba(245, 158, 11, 0.8)" : "rgba(0,0,0,0.4)",
          color: "white",
          alignSelf: position === "top" ? "center" : "flex-start",
        }}
      >
        {SEAT_LABELS[seat]} ({SEAT_WIND[seat]}) · {state.scores[seat]}
        {player.riichiDeclared && <span className="ml-1 text-yellow-300">🎴</span>}
      </div>
    </div>
  );
}

// ── Discard piles (center board) ──

function DiscardPile({
  seat,
  state,
  position,
}: {
  seat: Seat;
  state: GameState;
  position: "top" | "bottom" | "left" | "right";
}) {
  const tiles = state.players[seat].discards;
  // Limit to last 18 (3 rows of 6) for compactness
  const visible = tiles.slice(-18);
  const rotation = position === "top" ? 180 : position === "left" ? 90 : position === "right" ? 270 : 0;
  const isHorizontal = position === "top" || position === "bottom";

  const style: React.CSSProperties = {
    position: "absolute",
    display: "grid",
    gap: 2,
    gridTemplateColumns: isHorizontal ? "repeat(6, 1fr)" : "repeat(3, 1fr)",
  };
  if (position === "bottom") Object.assign(style, { bottom: 4, left: "50%", transform: "translateX(-50%)" });
  if (position === "top") Object.assign(style, { top: 4, left: "50%", transform: "translateX(-50%)" });
  if (position === "left") Object.assign(style, { left: 4, top: "50%", transform: "translateY(-50%)" });
  if (position === "right") Object.assign(style, { right: 4, top: "50%", transform: "translateY(-50%)" });

  return (
    <div style={style}>
      {visible.map((t, i) => (
        <Tile key={i} tile={t} size="sm" rotation={rotation as 0 | 90 | 180 | 270} />
      ))}
    </div>
  );
}

// ── Button ──

function Button({
  children,
  onClick,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant: "primary" | "success" | "danger";
}) {
  const bg =
    variant === "primary" ? "#2563eb" : variant === "success" ? "#16a34a" : "#dc2626";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: bg,
        color: "white",
        padding: "0.5rem 1rem",
        borderRadius: 8,
        fontWeight: 700,
        border: "none",
        cursor: "pointer",
        minHeight: "2.75rem",
      }}
    >
      {children}
    </button>
  );
}

// ── Result modal ──

function ResultModal({
  result,
  state,
  onNewHand,
}: {
  result: NonNullable<GameState["result"]>;
  state: GameState;
  onNewHand: () => void;
}) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", zIndex: 10 }}
    >
      <div
        className="rounded-2xl p-6 max-w-sm w-[90%] text-center"
        style={{ background: "var(--paper)", color: "var(--ink)" }}
      >
        <h2
          className="text-2xl font-bold mb-2"
          style={{ fontFamily: "Fraunces, serif" }}
        >
          {result.kind === "tsumo"
            ? "Tsumo!"
            : result.kind === "ron"
              ? "Ron!"
              : "Exhaustive draw"}
        </h2>
        {result.kind !== "draw" && (
          <>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {result.kind === "tsumo"
                ? `${SEAT_LABELS[result.winner!]} won on a self-draw`
                : `${SEAT_LABELS[result.winner!]} won off ${SEAT_LABELS[result.loser!]}'s discard`}
            </p>
            {result.cap && (
              <p className="text-lg font-bold my-1" style={{ color: "var(--accent)" }}>
                {result.cap}
              </p>
            )}
            <div className="my-3 flex flex-col items-center">
              <ul className="text-sm">
                {result.yakuNames?.map((y) => <li key={y}>{y}</li>)}
              </ul>
              <p className="font-bold mt-2">
                {result.han} han · {result.fu} fu · {result.totalPoints} pts
              </p>
            </div>
          </>
        )}
        <div className="mt-4 text-xs grid grid-cols-2 gap-1" style={{ color: "var(--muted)" }}>
          {([0, 1, 2, 3] as Seat[]).map((s) => (
            <div key={s}>
              {SEAT_LABELS[s]}: <strong>{state.scores[s]}</strong>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onNewHand}
          className="mt-5 px-5 py-3 rounded-xl font-bold"
          style={{ background: "var(--accent)", color: "#fff", minHeight: "2.75rem" }}
        >
          New hand
        </button>
      </div>
    </div>
  );
}
