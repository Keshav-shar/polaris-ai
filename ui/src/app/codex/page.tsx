import { CodexLibrary } from "../../components/codex-library";

export default function CodexPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-2 border-b border-astral-gold/20 pb-4 md:flex-row md:items-center">
        <div>
          <h1 className="font-serif text-2xl font-bold text-astral-gold">Astral Codex</h1>
          <p className="text-xs text-slate-400">
            Every scroll charted so far, across every constellation.
          </p>
        </div>
      </div>
      <CodexLibrary />
    </div>
  );
}
