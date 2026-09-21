# polaris-ai
Polaris turns a topic into a navigable, evidence-grounded **knowledge tree**: a fixed-height BFS construction pass
(brief + children per node), then a separate article-generation pass. Free-tier infrastructure only.

## Repository layout

```
polaris-ai/
├── service/    Backend (TypeScript, Express). Layered: domain <- application <- infrastructure/interfaces
│   ├── db/     Postgres migrations and seeds
│   ├── src/    domain, application, infrastructure, interfaces, composition, config, shared
│   └── tests/  unit, integration, e2e, fixtures
├── ui/         Next.js frontend (Vercel)
├── infra/      AWS resources, created by hand from docs/setup.md (README-only; no IaC)
└── docs/       design docs, build plan, conflicts log
```

Each app has its own `package.json`; there is no root package. Run `npm --prefix service run dev:api` and
`npm --prefix ui run dev` in two terminals (see `docs/setup.md`).

Every folder has a README describing its purpose, allowed dependencies and planned contents.
Start with [`service/README.md`](service/README.md) for the architecture rules and
[`docs/POLARIS_BUILD_PLAN.md`](docs/POLARIS_BUILD_PLAN.md) for the build order.
