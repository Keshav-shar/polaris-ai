import { ApiStatus } from "../components/api-status";
import { TreeBuilder } from "../components/tree-builder";

// The layout supplies <main>, the header and the footer, so a page renders only its own content.
export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="bg-gradient-to-r from-astral-gold via-amber-200 to-astral-starlight bg-clip-text font-serif text-3xl font-bold text-transparent">
          Invoke a Constellation
        </h1>
        <p className="text-xs text-slate-400">
          Name a topic and Polaris charts it as a navigable tree of knowledge, general to specific.
        </p>
      </div>
      <div className="flex justify-center">
        <ApiStatus />
      </div>
      <TreeBuilder />
    </div>
  );
}
