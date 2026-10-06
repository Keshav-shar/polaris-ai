# application/

**Purpose:** Orchestration: agents, fan-in and use-cases (the two passes run as message-driven use-cases; LangGraph wiring is planned in `graph/`, not yet adopted - C98). Reaches the outside world only through ports.

**May depend on:** domain, application/ports, config/constants, shared.

**Must not depend on:** infrastructure, interfaces, composition. Concrete SDKs (supabase-js, AWS SDK, LLM SDKs).

**Planned contents:**
See the sub-folders; this folder holds no files of its own.
