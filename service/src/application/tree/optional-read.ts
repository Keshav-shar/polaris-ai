import type { Logger } from "../../shared/logger";

// For a read that ENRICHES a response but is not the response: the signed-in reader's own progress or feedback on a
// lesson. A failure there must not take the lesson itself down (found live 2026-11-07, C143: a schema missing only
// the Phase C tables made every lesson answer 503). The value is dropped, the failure is logged with what was being
// read, and nothing is thrown. Never use this for the thing a request is ABOUT - that must still fail loudly.
export async function optionalRead<T>(
  read: Promise<T> | T | undefined,
  logger: Pick<Logger, "warn"> | undefined,
  what: string,
): Promise<T | undefined> {
  try {
    return await read;
  } catch (error) {
    logger?.warn("optional read failed: answering without it", { what, error });
    return undefined;
  }
}
