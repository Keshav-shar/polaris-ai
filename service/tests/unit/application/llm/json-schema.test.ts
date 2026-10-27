import { describe, expect, it } from "vitest";
import { z } from "zod";
import { responseSchemaFor } from "../../../../src/application/llm/json-schema";
import { WriterOutput } from "../../../../src/domain/schemas/article.schema";
import { ExpandOutput, RootExpandOutput } from "../../../../src/domain/schemas/node.schema";

type Node = Record<string, unknown>;

// Every object in the tree, so the strict-mode rules can be checked everywhere, not just at the top.
function objects(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) node.forEach((child) => objects(child, out));
  else if (typeof node === "object" && node !== null) {
    out.push(node as Node);
    Object.values(node).forEach((child) => objects(child, out));
  }
  return out;
}

describe("responseSchemaFor (C114)", () => {
  it.each([
    ["expand", ExpandOutput],
    ["expand-root", RootExpandOutput],
    ["writer", WriterOutput],
  ] as const)("makes %s strict: closed objects, every property required, no `format`", (name, schema) => {
    const converted = responseSchemaFor(schema, name);
    expect(converted?.name).toBe(name);
    for (const node of objects(converted?.schema)) {
      expect(node).not.toHaveProperty("format");
      expect(node).not.toHaveProperty("$schema");
      if (node.type === "object" && node.properties !== undefined) {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties as Node));
      }
    }
  });

  // Groq refuses `format: "uri"` in strict mode (measured); the URL is still checked by Zod after the reply.
  it("strips format from the writer's url fields but keeps the length and count keywords the decoder enforces", () => {
    const text = JSON.stringify(responseSchemaFor(WriterOutput, "writer")?.schema);
    expect(text).not.toContain('"format"');
    expect(text).toContain('"minItems":4');
    expect(text).toContain('"maximum":3');
  });

  it("makes the writer's optional questions required, so strict mode can accept the schema", () => {
    const schema = responseSchemaFor(WriterOutput, "writer")?.schema as Node;
    expect(schema.required).toEqual(["contentMd", "citations", "questions"]);
  });

  it("memoizes per schema object", () => {
    expect(responseSchemaFor(ExpandOutput, "expand")).toBe(responseSchemaFor(ExpandOutput, "expand"));
  });

  it("returns undefined for a schema with no JSON equivalent, so the call falls back to plain JSON mode", () => {
    const unrepresentable = z.object({ when: z.date() });
    expect(responseSchemaFor(unrepresentable, "x")).toBeUndefined();
  });
});
