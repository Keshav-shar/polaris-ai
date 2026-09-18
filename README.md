# polaris-ai
Contains an Automated interactive and personalized AI agent fine-tuned to handle educational aspects.

## Repository layout

```
polaris-ai/
├── service/    Backend (TypeScript, AWS Lambda). Layered: domain <- application <- infrastructure/interfaces
│   ├── db/     Postgres migrations and seeds
│   ├── src/    domain, application, infrastructure, interfaces, composition, config, shared
│   └── tests/  unit, integration, e2e, fixtures
├── infra/      AWS CDK stacks and constructs
└── ui/         Next.js frontend (Vercel)
```

Every folder has a README describing its purpose, allowed dependencies and planned contents.
Start with [`service/README.md`](service/README.md) for the architecture rules and open design issues.
