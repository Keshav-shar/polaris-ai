import { describe, expect, it } from "vitest";
import { createMemoryEvidenceRepository } from "../../../../src/infrastructure/memory/memory-evidence.repository";

const nodeId = "00000000-0000-4000-8000-000000000001";
const record = (url: string, id = nodeId) => ({
  nodeId: id,
  url,
  title: "A source",
  snippet: "Source text.",
  credibility: 0.9,
  retrievalQuery: "paging memory management",
  retrievedAt: "2026-10-07T00:00:00.000Z",
});

describe("memory evidence repository (C123)", () => {
  it("stores a node's evidence with its provenance and replaces it on a second write", async () => {
    const repo = createMemoryEvidenceRepository();
    await repo.replaceForNode(nodeId, [record("https://a.test/1"), record("https://a.test/2")]);
    await repo.replaceForNode(nodeId, [record("https://a.test/3")]);
    const stored = await repo.listForNode(nodeId);
    expect(stored.map((r) => r.url)).toEqual(["https://a.test/3"]);
    expect(stored[0]).toMatchObject({ retrievalQuery: "paging memory management", retrievedAt: "2026-10-07T00:00:00.000Z" });
  });

  it("is empty for a node with no evidence", async () => {
    expect(await createMemoryEvidenceRepository().listForNode(nodeId)).toEqual([]);
  });

  it("refuses a record that belongs to another node, or that fails the schema", async () => {
    const repo = createMemoryEvidenceRepository();
    await expect(
      repo.replaceForNode(nodeId, [record("https://a.test/1", "00000000-0000-4000-8000-000000000002")]),
    ).rejects.toThrow(/belong to node/);
    await expect(repo.replaceForNode(nodeId, [record("javascript:alert(1)")])).rejects.toThrow();
  });
});
