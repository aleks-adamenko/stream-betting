// Studio reuses the same handwritten schema types as user-app — single source
// of truth. When we later wire `supabase gen types`, this re-export stays.
export type { Database, Json } from "../../../../user-app/src/integrations/supabase/types";
