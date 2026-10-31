import { CodexLibrary } from "../../components/codex-library";

export default function CodexPage() {
  return (
    <div className="space-y-8">
      <div className="border-b border-rule pb-6">
        <h1 className="font-serif text-4xl font-bold tracking-wide text-ink md:text-5xl">My library</h1>
        <p className="mt-2 text-sm text-muted">Every map you&apos;ve built, with all of its lessons.</p>
      </div>
      <CodexLibrary />
    </div>
  );
}
