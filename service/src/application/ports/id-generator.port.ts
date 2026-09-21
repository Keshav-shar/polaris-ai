// Randomness injected, so use-cases stay deterministic under test: composition supplies randomUuid, tests
// a counter. Node ids are NOT generated here - they are derived deterministically (application/tree/node-ids.ts).
export type IdGeneratorPort = {
  next(): string;
};
