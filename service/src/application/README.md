# application/

**Purpose:** Orchestration: agents, the LangGraph state graph and use-cases. Reaches the outside world only through ports.

**May depend on:** domain, application/ports, config/constants, shared.

**Must not depend on:** infrastructure, interfaces, composition. Concrete SDKs (supabase-js, AWS SDK, LLM SDKs).

**Planned contents:**
See the sub-folders; this folder holds no files of its own.
