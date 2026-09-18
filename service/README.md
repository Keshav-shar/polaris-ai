# service/

Polaris backend: TypeScript, deployed to AWS Lambda (Always Free tier) with Supabase Postgres and DynamoDB for storage.
Source of truth for the design: `polaris-implementation-plan.md` (v2).

## Layers and the dependency rule

Dependencies point **inward only**. An inner layer never imports an outer one.

```
            interfaces ─────┐
  (http routes, lambdas)    │
                            ▼
            application ──► domain
  (agents, graph, use-cases)  (entities, traversal, schemas)
                            ▲
            infrastructure ─┘  implements application/ports
  (postgres, dynamodb, llm, search, aws)

            composition  ── the only place that news adapters and binds them to ports
```

| Layer | Contains | May import | Must not import |
|---|---|---|---|
| `domain` | entities, traversal engine, Zod schemas, errors | itself, `config/constants`, pure libs | everything else; I/O; `process.env`; clocks/randomness (inject) |
| `application` | ports, agents, LangGraph wiring, use-cases | `domain`, `config/constants`, `shared` | `infrastructure`, `interfaces`, SDKs |
| `infrastructure` | adapters implementing ports | `application/ports`, `domain`, SDKs | `interfaces`, use-cases, agents |
| `interfaces` | HTTP routes/middleware, Lambda handlers | use-cases, `domain/schemas`, `composition` (entry points) | `infrastructure` directly |
| `composition` | DI root | everything | (nobody imports it except entry points) |

Why: the traversal engine (plan section 2) must stay closed for modification and testable with fake nodes and zero LLM or AWS calls. The layering also lets Tier A start in memory and move to DynamoDB later (plan section 8, steps 4 and 7) by changing only `composition/`.

## Storage tiers to adapters

| Tier | Data | Adapter |
|---|---|---|
| A. Ephemeral tree (TTL 48h) | working topic nodes during a run | `infrastructure/dynamodb` |
| B. Presented content (forever) | topics, evidence, articles, quizzes, teaching agents | `infrastructure/postgres` |
| C. Per-user progress (forever) | time spent, quiz score, agent used | `infrastructure/dynamodb` |

## Conventions

- **Files:** kebab-case with a role suffix: `*.agent.ts`, `*.port.ts`, `*.repository.ts`, `*.use-case.ts`, `*.routes.ts`, `*.middleware.ts`, `*.lambda.ts`, `*.adapter.ts`, `*.error.ts`.
- **Validation at boundaries:** everything from an LLM, request or DB JSON column is parsed with a Zod schema from `domain/schemas`; types are inferred from the schema.
- **Dependency injection:** by constructor/function parameter. No module-level singletons except in `composition/`.
- **Errors:** expected failures are typed domain errors or `Result`; HTTP mapping happens only in `interfaces/http/middleware`.
- **Idempotency:** Lambda and SQS deliver at-least-once; every worker step must be safe to repeat.
- **Tests:** `tests/unit` (no network) > `tests/integration` (local DBs) > `tests/e2e` (Supertest). Guardrail and traversal engine carry the strictest coverage.
- **Each folder has a README** stating its purpose, allowed and forbidden dependencies, and planned contents. Update it when the folder's role changes.

## Open design issues in the plan (resolve while authoring the folders they affect)

1. `topic_configs` references `teaching_agents` before it exists; reorder the DDL. (`db/migrations`)
2. ltree labels allow only `[A-Za-z0-9_-]` up to 1000 chars; build paths from ids/slugs, not titles. (`db/migrations`, `domain/entities`)
3. `config_hash` ignores the traversal plan and personality, so edited agents reuse stale content; add an agent version. (`db/migrations`)
4. No durable run record for `GET /trees/:id` once Tier A's TTL expires. (`db/migrations`, `application/use-cases`)
5. No user/role model behind the "superadmin" RLS rule. (`db/migrations`, `interfaces/http/middleware`)
6. `vector(1536)` couples the schema to one embedding model. (`config`, `infrastructure/llm`)
7. Lambda container images need ECR, which is not Always Free; use zip bundles. (`infra/stacks`, `interfaces/workers`)
8. Step Functions' 4,000 free transitions/month will not cover one transition per node visit; verify and consider an SQS-driven loop. (`infra/stacks`)
9. AWS accounts created after 2025-07-15 use a credit-based Free Plan; confirm each service before deploy. (`infra`)
10. Supabase free tier: 500 MB, no backups, pauses after 7 days idle. (`infrastructure/postgres`)
