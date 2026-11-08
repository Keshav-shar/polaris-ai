// Relative imports only: ui/ type-checks this file, and there `@/` points at ui/src (docs/conflicts.md C41).
import { z } from "zod";

// Who is making a request, as the auth verifier established it from a Supabase access token (C105). Only the
// user id: everything else a use-case needs about a user (role, quota) it reads from the store by this id.
export const Caller = z.object({ userId: z.uuid() });
export type Caller = z.infer<typeof Caller>;
