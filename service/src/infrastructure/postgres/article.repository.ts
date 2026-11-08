import { z } from "zod";
import type { ArticleRepositoryPort } from "../../application/ports/article-repository.port";
import { Article } from "../../domain/schemas/article.schema";
import { check } from "./postgres-error";
import type { Db } from "./supabase.client";

const ArticleRow = z.object({
  content_md: z.string(),
  // Stored as { url, claim, evidence_id }; the read model needs the first two only.
  citations: z.array(z.object({ url: z.string(), claim: z.string() })),
  credibility_verified: z.boolean(),
});

// One article per node. Written through save_article, which resolves each citation's url to the node's own
// evidence row in the same statement (C78).
export function createPostgresArticleRepository(db: Db): ArticleRepositoryPort {
  return {
    async upsert(article) {
      check(
        "articles.upsert",
        await db.rpc("save_article", {
          p_node_id: article.nodeId,
          p_content_md: article.contentMd,
          p_citations: article.citations.map(({ url, claim }) => ({ url, claim })),
          p_credibility_verified: article.credibilityVerified,
        }),
      );
    },

    async get(nodeId) {
      const result = await db
        .from("articles")
        .select("content_md, citations, credibility_verified")
        .eq("node_id", nodeId)
        .maybeSingle();
      check("articles.get", result);
      if (result.data === null) return undefined;
      const row = ArticleRow.parse(result.data);
      // Validated against the same contract the writer's output was, so a corrupted row cannot reach the reader.
      return Article.parse({
        nodeId,
        contentMd: row.content_md,
        citations: row.citations.map(({ url, claim }) => ({ url, claim })),
        credibilityVerified: row.credibility_verified,
      });
    },
  };
}
