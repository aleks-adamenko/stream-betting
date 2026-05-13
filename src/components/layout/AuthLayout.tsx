import { Link } from "react-router-dom";
import { Zap } from "lucide-react";

import logoUrl from "@/assets/live-rush-white-logo.png";
import { cn } from "@/lib/utils";

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function AuthLayout({ title, subtitle, children, footer, className }: AuthLayoutProps) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-gradient-to-br from-[#1973FF] to-[#5048FF] text-white">
      {/* Dotted radial pattern overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "14px 14px",
        }}
      />
      {/* Big decorative bolt */}
      <Zap
        aria-hidden
        className="pointer-events-none absolute -right-20 top-1/4 h-[28rem] w-[28rem] -rotate-12 fill-white/[0.06] stroke-none"
      />

      <header className="relative flex h-16 items-center px-5 sm:px-8">
        <Link to="/" className="inline-flex items-center" aria-label="LiveRush home">
          <img src={logoUrl} alt="LiveRush" className="h-7 w-auto" />
        </Link>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
        <div
          className={cn(
            "w-full max-w-md rounded-2xl border border-white/15 bg-white/[0.06] p-6 backdrop-blur-sm sm:p-8",
            className,
          )}
          style={{
            boxShadow:
              "0 24px 48px -16px rgba(0, 0, 0, 0.35), 0 8px 24px -12px rgba(0, 0, 0, 0.25)",
          }}
        >
          <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-sm text-white/75">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-white/75">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
