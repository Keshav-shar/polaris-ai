import { createLambdaHandlers, getWorkerContainer } from "../../composition/worker-container";

// Lambda `write-article`, triggered by `polaris-article-write` AND `polaris-article-write-priority` (two event source mappings, batch size 1, ReportBatchItemFailures).
export const handler = createLambdaHandlers(getWorkerContainer).writeArticle;
