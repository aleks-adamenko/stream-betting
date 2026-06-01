import { BarChart3 } from "lucide-react";

/**
 * /stats — placeholder. Real metrics (DAU, conversion to bet, average
 * stake, lifetime creator revenue, fraud signals) land in a later phase
 * once the operator decides which numbers matter most. Stub-shaped for
 * now so the sidebar nav slot exists.
 */
export default function Stats() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <BarChart3 className="h-8 w-8 text-primary" />
      </div>
      <h1 className="mt-4 font-heading text-2xl font-bold">Stats coming soon</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Platform metrics — engagement, conversion, fraud — will land
        here in a later phase once the spec is finalised.
      </p>
    </div>
  );
}
