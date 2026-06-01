// Admin reuses the same handwritten schema types as user-app + studio —
// single source of truth lives in apps/user-app/src/integrations/supabase/types.ts.
// Admin-only RPCs (is_admin, approve_creator, list_admin_*, etc.) are
// already included in the source file's Functions block.
export type { Database, Json } from "../../../../user-app/src/integrations/supabase/types";
