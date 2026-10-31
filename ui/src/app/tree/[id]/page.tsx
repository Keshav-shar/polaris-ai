import Link from "next/link";
import { RunPanel } from "../../../components/run-panel";

// Next 16: route params arrive as a Promise and must be awaited
// (node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md).
export default async function TreePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-6">
        <h1 className="font-serif text-4xl font-bold tracking-wide text-ink md:text-5xl">Your learning map</h1>
        <Link href="/" className="text-xs font-semibold uppercase tracking-widest text-ink hover:text-gold-ink">
          ← Learn something new
        </Link>
      </div>
      <RunPanel runId={id} />
    </div>
  );
}
