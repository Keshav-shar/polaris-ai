# service/

Polaris backend: TypeScript, Express 5, Zod 4, vitest. Supabase Postgres is the permanent store (from Phase 12). The tree-build path runs on SQS + Lambda + DynamoDB (Phase 13; in-memory queues locally before that). Express is hosted on Vercel, not AWS.
Source of truth: `.claude/CLAUDE.md` and the docs it links, `docs/polaris-aws-retrofit.md` + `docs/aws-retrofit.md` for the build path; build order in `docs/POLARIS_BUILD_PLAN.md`.

## Layers and the dependency rule

Dependencies point **inward only**. An inner layer never imports an outer one.

```
            interfaces ─────┐
  (http routes, workers)    │
                            ▼
            application ──► domain
  (agents, fan-in, graph,     (entities, traversal rules,
   use-cases)                  credibility, schemas)
                            ▲
            infrastructure ─┘  implements application/ports
  (memory, postgres, dynamodb, aws/sqs, llm, search)

            composition  ── the only place that news adapters and binds them to ports
```

| Layer | Contains | May import | Must not import |
|---|---|---|---|
| `domain` | entities, credibility rules, layer-position rules, Zod schemas, errors | itself, `config/constants`, `shared/words.ts`, pure libs | everything else; I/O; `process.env`; clocks/randomness (inject) |
| `application` | ports, agents, fan-in, LangGraph wiring, use-cases | `domain`, `config/constants`, `shared` | `infrastructure`, `interfaces`, SDKs |
| `infrastructure` | adapters implementing ports | `application/ports`, `domain`, SDKs | `interfaces`, use-cases, agents |
| `interfaces` | HTTP routes/middleware, queue workers (local worker, Lambda handlers) | use-cases, `domain/schemas`, `composition` (entry points) | `infrastructure` directly |
| `composition` | DI root | everything | (nobody imports it except entry points) |

Why: the construction and article passes must be testable with fake agents and zero LLM, database or AWS calls. The layering also lets queues, state and repositories start in memory and move to SQS / DynamoDB / Postgres by changing only `composition/`.

## Storage to adapters

| Data | Phases 2-11 (local) | Production |
|---|---|---|
| Runs, tree nodes, evidence, articles, quizzes (permanent) | `infrastructure/memory` | `infrastructure/postgres` (Phase 12) |
| In-flight node state, fan-in counters, dedup keys (TTL 7 days) | `infrastructure/memory` | `infrastructure/dynamodb` (Phase 13) |
| Messages (construct / article queues + DLQs) | `infrastructure/memory` + local worker | `infrastructure/aws` (SQS, Phase 13) |

## Conventions

- **Files:** kebab-case with a role suffix: `*.agent.ts`, `*.prompt.ts`, `*.port.ts`, `*.repository.ts`, `*.store.ts`, `*.use-case.ts`, `*.routes.ts`, `*.middleware.ts`, `*.lambda.ts`, `*.adapter.ts`, `*.error.ts`, `*.schema.ts`.
- **Validation at boundaries:** everything from an LLM, request or DB JSON column is parsed with a Zod schema from `domain/schemas`; types are inferred from the schema.
- **Dependency injection:** by constructor/function parameter. No module-level singletons except in `composition/`.
- **Errors:** expected failures are typed domain errors or `Result`; HTTP mapping happens only in `interfaces/http/middleware`.
- **Idempotency:** SQS delivers at-least-once; every message handler must be safe to repeat (conditional writes, stored results reused, deterministic child ids — `docs/aws-retrofit.md`).
- **Tests:** `tests/unit` (no network) > `tests/integration` (local DBs) > `tests/e2e` (not used by the node-builder MVP). Runner: vitest. The verifier, guardrail, fan-in and message idempotency carry the strictest coverage. Tests never call AWS.
- **Each folder has a README** stating its purpose, allowed and forbidden dependencies, and planned contents. Update it when the folder's role changes.

## Known plan defects — do not reproduce them

1. ltree labels allow only `[A-Za-z0-9_-]` up to 1000 chars; build paths from ids, not titles. (`db/migrations`, `domain/entities`)
2. Keep a durable `runs` record; do not rely on an expiring store for run status. (`db/migrations`, `application/use-cases`)
3. Create FK targets before the tables that reference them (`runs` before `nodes`). (`db/migrations`)
4. The embedding dimension is defined once (`EMBEDDING_DIMENSION`); never hard-code `vector(1536)`. (`config`, `infrastructure/llm`)
5. Supabase free tier: 500 MB, no backups, pauses after 7 days idle. (`infrastructure/postgres`)
6. AWS: zip bundles, not container images (ECR is not Always Free); accounts created after 2025-07-15 use a credit-based Free Plan, so confirm each service. (`interfaces/workers`, `scripts`)
7. The design doc's IAM role omits `sqs:GetQueueAttributes`, `sqs:ChangeMessageVisibility` and CloudWatch Logs; its visibility timeout (2-3×) is below AWS guidance (6×); on-demand DynamoDB is not free. Use the amended values in `docs/aws-retrofit.md`. (`infrastructure/aws`, `infrastructure/dynamodb`, `docs/setup.md`)

Items that applied only to the superseded v2 design (teaching-agent FK order, `config_hash`, superadmin RLS, Step Functions transitions) are recorded in `docs/conflicts.md`.
