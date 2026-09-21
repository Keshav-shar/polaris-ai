# workers/

**Purpose:** Queue consumers. Each call handles one message and must be idempotent.

**May depend on:** application/use-cases, domain/schemas, composition, shared, `aws-lambda` types.

**Must not depend on:** infrastructure directly.

**Planned contents:**
- `local-queue-worker.ts` — drains the queue in-process for `QUEUE_MODE=memory` at concurrency `W_expand`; redelivers failures up to `QUEUE.MAX_RECEIVES`, then calls the dead-letter use-case. Holds `NodeQueueConsumerPort`, never an adapter. On `QuotaExhaustedError` it halts instead of dead-lettering: a daily quota clears, so marking nodes failed for it would be wrong (Phase 6). A halt settles `idle()` too - the stalled message deliberately stays queued, so waiting for an empty queue waited forever - and `onFatal(error, message)` is **awaited** before the slot is released, so the run is marked `halted` before a caller can read it (Phase 6.1, C55)
- `expand-node.lambda.ts` — SQS trigger on `polaris-node-expand`, batch size 1 → `expand-node` use-case (Phase 13)
- `write-article.lambda.ts` — SQS trigger on `polaris-article-write`, batch size 1 → `write-article` use-case (Phase 13)
- `handle-dead-letter.lambda.ts` — triggers on both DLQs → dead-letter use-case, branch on `pass` (Phase 13)

**Design notes:**
- Handlers only parse the SQS record with `NodeMessage` and call a use-case; throwing lets SQS redeliver.
- Bundled by `scripts/build-lambdas.mjs` into zips (`nodejs22.x`, no container images). Pseudocode: `docs/aws-retrofit.md`.
