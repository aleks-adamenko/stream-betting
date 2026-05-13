import { Link } from "react-router-dom";
import { Zap } from "lucide-react";

import logoUrl from "@/assets/live-rush-white-logo.png";
import { cn } from "@/lib/utils";

interface AuthLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export function AuthLayout({ children, className }: AuthLayoutProps) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-gradient-to-r from-[#1973FF] to-[#5048FF] text-white">
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

      {/* Decorative bolts in the background — symmetric corners */}
      <Zap
        aria-hidden
        className="pointer-events-none absolute -left-16 top-1/4 h-72 w-72 rotate-12 fill-white/[0.08] stroke-none"
      />
      <Zap
        aria-hidden
        className="pointer-events-none absolute -right-16 bottom-1/4 h-72 w-72 -rotate-12 fill-white/[0.08] stroke-none"
      />

      {/* Centered logo at top */}
      <header className="relative flex justify-center pt-8 sm:pt-10">
        <Link to="/" aria-label="LiveRush home">
          <img src={logoUrl} alt="LiveRush" className="h-8 w-auto sm:h-9" />
        </Link>
      </header>

      {/* Card */}
      <main className="relative flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
        <div
          className={cn(
            "w-full max-w-md rounded-3xl border border-white/15 bg-white/[0.06] p-6 backdrop-blur-sm sm:p-8",
            className,
          )}
          style={{
            boxShadow:
              "0 24px 48px -16px rgba(0, 0, 0, 0.35), 0 8px 24px -12px rgba(0, 0, 0, 0.25)",
          }}
        >
          {children}
        </div>
      </main>

      {/* Bottom footer */}
      <footer className="relative flex items-center justify-center px-4 pb-6 text-[11px] text-white/70 sm:pb-8 sm:text-xs">
        <span>© {new Date().getFullYear()} LiveRush</span>
      </footer>
    </div>
  );
}

/* ---------- Reusable building blocks for auth pages ---------- */

interface AuthTitleProps {
  children: React.ReactNode;
  subtitle?: string;
}

/**
 * Title block with a yellow crown above and two decorative spark
 * bursts flanking the heading (matches design reference).
 */
export function AuthTitle({ children, subtitle }: AuthTitleProps) {
  return (
    <div className="text-center">
      <Crown className="mx-auto -mb-1 h-7 w-auto" />
      <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
        {children}
      </h1>
      {subtitle && <p className="mt-2 text-sm text-white/75">{subtitle}</p>}
    </div>
  );
}

export function AuthDivider() {
  return (
    <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-white/55">
      <span className="h-px flex-1 bg-white/20" />
      <span>OR</span>
      <span className="h-px flex-1 bg-white/20" />
    </div>
  );
}

/* ---------- SVG primitives ---------- */

function Crown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 32" className={className} fill="none" aria-hidden>
      <path
        d="M6 22 L4 8 L14 18 L24 4 L34 18 L44 8 L42 22 Z"
        stroke="#FEE53A"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="4" cy="8" r="2" fill="#FEE53A" />
      <circle cx="24" cy="4" r="2.4" fill="#FEE53A" />
      <circle cx="44" cy="8" r="2" fill="#FEE53A" />
    </svg>
  );
}

