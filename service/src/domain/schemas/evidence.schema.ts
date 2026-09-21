import { z } from "zod";

export const EvidenceItem = z.object({
  url: z.url(),
  title: z.string(),
  snippet: z.string(),
  credibility: z.number().min(0).max(1),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;
