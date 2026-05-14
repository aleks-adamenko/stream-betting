import { Link } from "react-router-dom";
import { Wallet, ListChecks, Plus, Bell } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useMyBets } from "@/hooks/useMyBets";

export function SideNavUserCard() {
  const { profile, user } = useAuth();
  const { data: bets } = useMyBets();
  const openBetsCount = bets?.filter((b) => b.status === "open").length ?? 0;
  const balanceDollars = (profile?.balance_cents ?? 0) / 100;
  const handle = profile?.display_name ?? user?.email?.split("@")[0] ?? "you";
  const initials = handle.slice(0, 2).toUpperCase();

  return (
    <div
      className="relative mt-[19px] overflow-visible rounded-2xl border border-white/15 bg-black/[0.06] px-2.5 pt-5 pb-2.5 text-white backdrop-blur-sm"
      style={{
        boxShadow:
          "0 12px 24px -16px rgba(0, 0, 0, 0.35), 0 4px 12px -12px rgba(0, 0, 0, 0.25)",
      }}
    >
      {/* Decorative bolt outside on the right */}
      <BoltDecor className="pointer-events-none absolute -right-3 top-6 h-9 w-9" />
      {/* Decorative small bolt near My bets icon */}
      <SmallBolt className="pointer-events-none absolute right-[14px] top-[19px] h-4 w-4 -rotate-12" />

      {/* Header: avatar with crown + handle — clickable, goes to /profile */}
      <Link
        to="/profile"
        aria-label="Profile"
        className="relative flex items-center gap-3 rounded-2xl transition-colors hover:opacity-90"
      >
        <div className="relative flex-shrink-0">
          {/* Crown above avatar */}
          <Crown className="pointer-events-none absolute -top-3 -left-1 h-5 w-auto -rotate-12" />
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={handle}
              className="h-12 w-12 rounded-full object-cover ring-2 ring-white/40"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 font-heading text-base font-bold ring-2 ring-white/40">
              {initials}
            </div>
          )}
          {/* Online dot */}
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#3057FF] bg-success" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-base font-bold hover:underline">
            {handle}
          </p>
        </div>
      </Link>

      {/* Balance card with + button */}
      <div className="relative mt-4 rounded-2xl bg-white/[0.08] p-3 pr-14 ring-1 ring-white/15">
        {/* Top row: icon + label */}
        <div className="relative flex items-center gap-1.5">
          <Wallet className="h-3.5 w-3.5 text-white/80" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-white/85">
            Balance
          </span>
        </div>

        {/* Amount */}
        <div className="relative mt-2">
          <span className="font-heading text-2xl font-extrabold leading-none tabular-nums text-white">
            ${balanceDollars.toFixed(2)}
          </span>
        </div>

        {/* Plus button — accent variant, vertically centered to the whole container */}
        <Link
          to="/balance/top-up"
          aria-label="Add funds"
          className="absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[hsl(227_47%_21%)] shadow-lg ring-4 ring-[#FED448]/40 transition-all duration-200 hover:-translate-y-1/2 hover:scale-105 hover:shadow-xl"
          style={{ backgroundImage: "linear-gradient(90deg,#FFDD49,#FFBE3B)" }}
        >
          <Plus className="h-4 w-4" strokeWidth={3} />
        </Link>
      </div>

      {/* Menu */}
      <div className="relative mt-3 space-y-1">
        <Link
          to="/my-bets"
          className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ListChecks className="h-4 w-4" />
          <span className="flex-1">My bets</span>
          {openBetsCount > 0 && (
            <span className="ml-auto inline-flex items-center rounded-md bg-[#2A1FCF] px-1.5 py-0 text-[11px] font-black uppercase tracking-wide tabular-nums text-white">
              {openBetsCount}
            </span>
          )}
        </Link>
        <Link
          to="/notifications"
          className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Bell className="h-4 w-4" />
          <span className="flex-1">Notifications</span>
          <span className="ml-auto inline-flex items-center rounded-md bg-[#2A1FCF] px-1.5 py-0 text-[11px] font-black uppercase tracking-wide text-white">
            New
          </span>
        </Link>
      </div>
    </div>
  );
}

/* ---------- decorations ---------- */

function Crown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 32" className={className} fill="none" aria-hidden>
      <path
        d="M6 22 L4 8 L14 18 L24 4 L34 18 L44 8 L42 22 Z"
        stroke="#FEE53A"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="rgba(254,229,58,0.15)"
      />
      <circle cx="4" cy="8" r="2.5" fill="#FEE53A" />
      <circle cx="24" cy="4" r="3" fill="#FEE53A" />
      <circle cx="44" cy="8" r="2.5" fill="#FEE53A" />
    </svg>
  );
}

function BoltDecor({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <path
        d="M18 2 L8 18 L15 18 L13 30 L24 12 L17 12 Z"
        fill="#FEE53A"
        stroke="#FEE53A"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SmallBolt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path
        d="M14 2 L6 14 L11 14 L10 22 L18 10 L13 10 Z"
        stroke="#FEE53A"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="rgba(254,229,58,0.15)"
      />
    </svg>
  );
}

function DoodleStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path
        d="M12 2 L13.5 9 L21 10 L15.5 14.5 L17 22 L12 18 L7 22 L8.5 14.5 L3 10 L10.5 9 Z"
        stroke="#FEE53A"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
