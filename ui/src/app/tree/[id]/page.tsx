import Link from "next/link";
import { RunPanel } from "../../../components/run-panel";

// Next 16: route params arrive as a Promise and must be awaited
// (node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md).
export default async function TreePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="bg-gradient-to-r from-astral-gold via-amber-200 to-astral-starlight bg-clip-text font-serif text-2xl font-bold text-transparent">
          Constellation Tree
        </h1>
        <Link href="/" className="font-serif text-sm text-astral-gold hover:underline">
          ← Chart another
        </Link>
      </div>
      <RunPanel runId={id} />
    </div>
  );
}
