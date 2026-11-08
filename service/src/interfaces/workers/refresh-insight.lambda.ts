import { createLambdaHandlers, getWorkerContainer } from "../../composition/worker-container";

// Lambda `refresh-insight`, triggered by `polaris-insight-refresh` (A21).
export const handler = createLambdaHandlers(getWorkerContainer).refreshInsight;
