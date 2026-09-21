// Wraps untrusted text (user input, earlier LLM output) in <tag>…</tag>, stripping that tag from the content so
// the text cannot close the block early. System prompts tell the model the block is data, never instructions.
export function dataBlock(tag: string, content: string): string {
  const delimiter = new RegExp(`</?${tag}>`, "gi");
  return `<${tag}>\n${content.replace(delimiter, "")}\n</${tag}>`;
}
