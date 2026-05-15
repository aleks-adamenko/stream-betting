import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, UserCircle } from "lucide-react";

import logoUrl from "@/assets/live-rush-logo-2.png";
import { useAuth } from "@/contexts/AuthContext";

export function EventMobileTopBar() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const balanceDollars = (profile?.balance_cents ?? 0) / 100;

  return (
    <header
      className="z-30 flex-shrink-0 bg-background lg:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="relative flex h-14 items-center px-2.5">
        {/* Back */}
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-primary/15 transition-transform hover:scale-105"
        >
          <ArrowLeft className="h-5 w-5 text-primary" strokeWidth={2.5} />
        </button>

        {/* Centered logo */}
        <Link
          to="/"
          aria-label="LiveRush home"
          className="absolute left-1/2 inline-flex -translate-x-1/2 items-center"
        >
          <img src={logoUrl} alt="LiveRush" className="h-6 w-auto" />
        </Link>

        {/* Right cluster: balance + avatar */}
        <div className="ml-auto flex items-center gap-1.5">
          {user && (
            <div className="flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3 shadow-md ring-1 ring-primary/10">
              <Link
                to="/balance/top-up"
                aria-label="Add funds"
                className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[hsl(227_47%_21%)] shadow-md ring-4 ring-[#FED448]/40 transition-transform hover:scale-105"
                style={{ backgroundImage: "linear-gradient(90deg,#FFDD49,#FFBE3B)" }}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={3} />
              </Link>
              <span className="font-heading text-sm font-bold tabular-nums text-foreground">
                ${balanceDollars.toFixed(2)}
              </span>
            </div>
          )}

          <Link
            to={user ? "/profile" : "/auth/sign-in"}
            aria-label={user ? "Profile" : "Sign in"}
            className="relative inline-flex h-10 w-10 flex-shrink-0 items-center justify-center"
          >
            {user && profile?.avatar_url ? (
              <>
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-10 w-10 rounded-full object-cover ring-2 ring-white shadow-md"
                />
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-success" />
              </>
            ) : (
              <UserCircle className="h-7 w-7 text-primary" />
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
