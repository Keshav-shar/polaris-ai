# domain/

**Purpose:** Pure business logic and the vocabulary of the system. The innermost layer and the most heavily unit-tested.

**May depend on:** Itself, `config/constants.ts`, and pure I/O-free libraries (zod, tinyqueue).

**Must not depend on:** application, infrastructure, interfaces, composition. AWS/Supabase/LLM SDKs. `process.env`, `Date.now()`, `Math.random()` (inject a clock/rng instead). Logging.

**Planned contents:**
See the sub-folders; this folder holds no files of its own.
