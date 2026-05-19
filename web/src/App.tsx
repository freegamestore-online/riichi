import { GameShell, GameTopbar } from "@freegamestore/games";

export default function App() {
  return (
    <GameShell topbar={<GameTopbar title="riichi" score={0} />}><div className="flex flex-col items-center justify-center h-full gap-4">
      <h1
        className="text-3xl font-bold mb-4"
        style={{ fontFamily: "Fraunces, serif" }}
      >
        Welcome to riichi
      </h1>
      <p style={{ color: "var(--muted)" }}>
        Edit <code>src/App.tsx</code> to get started.
      </p>
    </div></GameShell>
  );
}
