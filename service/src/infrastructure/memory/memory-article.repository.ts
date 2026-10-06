import type { ArticleRepositoryPort } from "../../application/ports/article-repository.port";
import type { Article } from "../../domain/schemas/article.schema";

export function createMemoryArticleRepository(): ArticleRepositoryPort {
  const articles = new Map<string, Article>();

  const copy = (article: Article): Article => ({ ...article, citations: [...article.citations] });

  return {
    // Rule 6: last write wins on the same key, which is what makes a redelivery harmless.
    async upsert(article: Article) {
      articles.set(article.nodeId, copy(article));
    },
    async get(nodeId: string) {
      const article = articles.get(nodeId);
      return article === undefined ? undefined : copy(article);
    },
  };
}
