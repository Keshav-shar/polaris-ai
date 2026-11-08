import { createLambdaHandlers, getWorkerContainer } from "../../composition/worker-container";

// Lambda `expand-node`, triggered by `polaris-node-expand` (batch size 1, ReportBatchItemFailures). Handler: index.handler.
export const handler = createLambdaHandlers(getWorkerContainer).expandNode;
