-- ltree for the tree hierarchy (labels built from node ids, never titles); pgcrypto per data-model.md.
-- `vector` is added only when semantic dedup is scheduled (decisions.md Q7).
create extension if not exists ltree with schema extensions;
create extension if not exists pgcrypto with schema extensions;
