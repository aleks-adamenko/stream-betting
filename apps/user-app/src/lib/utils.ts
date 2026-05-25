// Thin shim — the real implementation lives in @liverush/lib so it can be
// reused by studio and admin without duplication. Kept under @/lib/utils so
// existing `import { cn } from "@/lib/utils"` call sites stay untouched.
export { cn } from "@liverush/lib";
