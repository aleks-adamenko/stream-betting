import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";

export default function NotFound() {
  return (
    <PageContainer className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md text-center">
        <p className="font-heading text-6xl font-bold text-gradient">404</p>
        <h1 className="mt-4 font-heading text-2xl font-bold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has moved.
        </p>
        <Button asChild size="lg" className="mt-6">
          <Link to="/">Back home</Link>
        </Button>
      </div>
    </PageContainer>
  );
}
