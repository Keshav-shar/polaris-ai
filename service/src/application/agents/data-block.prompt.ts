// Wraps untrusted text (user input, search results, earlier LLM output) in <tag>…</tag>, stripping every form
// of that tag from the content so the text cannot close the block early. Every VARIANT goes, not just the
// exact spelling: `</tag >`, `< /tag>` and `</tag x="y">` all close a block as far as a model is concerned
// (docs/conflicts.md C103). System prompts tell the model the block is data, never instructions.
export function dataBlock(tag: string, content: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const delimiter = new RegExp(`<\\s*/?\\s*${escaped}\\b[^>]*>`, "gi");
  return `<${tag}>\n${content.replace(delimiter, "")}\n</${tag}>`;
}
