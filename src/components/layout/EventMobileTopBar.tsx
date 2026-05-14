import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, UserCircle } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";

export function EventMobileTopBar() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  return (
    <header
      className="lg:hidden z-30 flex-shrink-0 bg-gradient-to-r from-[#1973FF] to-[#5048FF] text-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex h-14 items-center justify-between pl-3 pr-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/10"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <Link
          to={user ? "/profile" : "/auth/sign-in"}
          aria-label={user ? "Profile" : "Sign in"}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/10"
        >
          {user && profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="h-8 w-8 rounded-full object-cover ring-2 ring-white/40"
            />
          ) : (
            <UserCircle className="h-6 w-6" />
          )}
        </Link>
      </div>
    </header>
  );
}
