import { createLambdaHandlers, getWorkerContainer } from "../../composition/worker-container";

// Lambda `handle-dead-letter`, triggered by `polaris-node-expand-dlq` and `polaris-article-write-dlq`.
export const handler = createLambdaHandlers(getWorkerContainer).handleDeadLetter;
