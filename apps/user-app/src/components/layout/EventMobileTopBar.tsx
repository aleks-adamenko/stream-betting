import type { CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, UserCircle } from "lucide-react";

import { CoinIcon } from "@/components/ui/CoinAmount";
import { useAuth } from "@/contexts/AuthContext";
import { totalBalanceCents } from "@/lib/balance";

interface EventMobileTopBarProps {
  style?: CSSProperties;
}

/**
 * Mobile event-page top bar. Matches the visual treatment of the
 * regular MobileTopBar (blue gradient, white text, bare balance
 * link + ringed avatar) but drops the logo + nav-tab strip — the
 * event page doesn't need feed navigation. The left slot is the
 * back-arrow button so the viewer can return to wherever they came
 * from (Home, Feed, Following, Discover) with one tap.
 *
 * Rendered INSIDE the scrolling main on event routes; the parent
 * AppLayout passes a `style` prop that drives the pull-to-reveal
 * gesture (translateY + margin-bottom + animated transition).
 */
export function EventMobileTopBar({ style }: EventMobileTopBarProps) {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const balanceDollars = totalBalanceCents(profile?.balance_cents) / 100;

  return (
    <header
      className="z-30 flex-shrink-0 bg-gradient-to-r from-[#1973FF] to-[#5048FF] text-white lg:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)", ...style }}
    >
      <div className="flex h-14 items-center gap-2 pl-3 pr-2">
        {/* Back arrow — replaces the LiveRush logo slot from the
            standard MobileTopBar. Same h-10 w-10 hit-box, same
            white-on-blue hover treatment as the avatar button on
            the right so the two ends of the bar feel symmetric. */}
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white hover:bg-white/10"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={2.5} />
        </button>

        {/* Spacer — flex-1 pushes the right cluster to the edge.
            The standard MobileTopBar uses this slot for the nav-tab
            strip; on the event page we leave it empty since the
            user is already deep-linked to one event. */}
        <div className="min-w-0 flex-1" />

        {/* Right cluster: bare balance link (signed-in only) +
            avatar. Identical to the regular MobileTopBar. Tapping
            the balance jumps to /coins for top-up. */}
        <div className="flex flex-shrink-0 items-center gap-3">
          {user && (
            <Link
              to="/coins"
              aria-label={`Balance ${balanceDollars.toFixed(2)} — get coins`}
              className="inline-flex items-center gap-1.5 font-heading text-base font-extrabold leading-none tabular-nums text-white outline-none transition-opacity hover:opacity-80"
            >
              <CoinIcon />
              {balanceDollars.toFixed(2)}
            </Link>
          )}
          <Link
            to={user ? "/profile" : "/auth/sign-in"}
            aria-label={user ? "Profile" : "Sign in"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/10"
          >
            {user && profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                // Solid 2px white ring — matches the MobileTopBar
                // and DesktopTopNav avatar treatment.
                className="h-8 w-8 rounded-full object-cover ring-2 ring-white"
              />
            ) : (
              <UserCircle className="h-6 w-6" />
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
