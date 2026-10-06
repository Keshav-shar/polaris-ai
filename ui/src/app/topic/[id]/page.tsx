import { ScrollReader } from "../../../components/scroll-reader";

// Next 16: route params arrive as a Promise and must be awaited
// (node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md).
export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScrollReader nodeId={id} />;
}
