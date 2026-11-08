import { z } from "zod";
import type { ArticleDraftPort } from "../../application/ports/article-draft.port";
import { ArticleDraft } from "../../domain/schemas/article.schema";
import { check } from "./postgres-error";
import type { Db } from "./supabase.client";

// article_drafts (0016): the writer's stored result on AWS (A14, A23). Validated in and out: a draft becomes an
// article and a quiz, so a malformed row must fail here rather than be served.
export function createPostgresArticleDraftRepository(db: Db): ArticleDraftPort {
  return {
    async get(nodeId) {
      const result = await db.from("article_drafts").select("draft").eq("node_id", nodeId).maybeSingle();
      check("articleDrafts.get", result);
      if (result.data === null) return undefined;
      return ArticleDraft.parse(z.object({ draft: z.unknown() }).parse(result.data).draft);
    },

    async putIfAbsent(nodeId, draft) {
      const result = await db.rpc("put_article_draft", { p_node_id: nodeId, p_draft: ArticleDraft.parse(draft) });
      check("articleDrafts.putIfAbsent", result);
      return ArticleDraft.parse(result.data);
    },
  };
}
