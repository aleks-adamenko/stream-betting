import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Camera, KeyRound, LogOut, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  uploadAvatar,
  updateDisplayName,
  AVATAR_MAX_BYTES,
  AVATAR_ALLOWED_MIME,
} from "@/services/profileService";

export default function Profile() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = useState<string>(profile?.display_name ?? "");
  const initialName = profile?.display_name ?? "";

  useEffect(() => {
    setNameDraft(profile?.display_name ?? "");
  }, [profile?.display_name]);

  // `fallbackHandle` is still passed to uploadAvatar's success
  // toast indirectly via the profile refresh — the avatar circle
  // moved into the ProfileLayout sidebar so we no longer render it
  // here, just keep the file upload trigger inside the "Profile
  // photo" card.

  const avatarMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Not signed in");
      return uploadAvatar(file, user.id);
    },
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Profile photo updated");
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast.error(message);
    },
  });

  const nameMutation = useMutation({
    mutationFn: async (name: string) => updateDisplayName(name),
    onSuccess: async () => {
      await refreshProfile();
      toast.success("Display name updated");
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Update failed";
      toast.error(message);
    },
  });

  const handleFile = (file: File) => {
    if (!AVATAR_ALLOWED_MIME.includes(file.type)) {
      toast.error("Use a JPG or PNG file.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error(
        `File is too large (${(file.size / 1024).toFixed(0)} KB). Max 200 KB.`,
      );
      return;
    }
    avatarMutation.mutate(file);
  };

  const trimmed = nameDraft.trim();
  const nameChanged = trimmed !== initialName.trim();
  const nameValid = trimmed.length >= 2 && trimmed.length <= 30;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="font-heading text-2xl font-bold sm:text-3xl">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Manage how you appear on LiveRush.
        </p>

        {/* Photo upload card */}
        <div className="mt-6 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="font-heading text-base font-semibold">Profile photo</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            JPG or PNG, max 200 KB. Square images look best.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarMutation.isPending}
            >
              <Camera className="h-4 w-4" />
              {avatarMutation.isPending ? "Uploading…" : "Change photo"}
            </Button>
          </div>
        </div>

        {/* Display name card */}
        <div className="mt-5 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="font-heading text-base font-semibold">Display name</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Shown instead of your email throughout LiveRush.
          </p>
          <div className="mt-4 space-y-2">
            <label htmlFor="display-name" className="sr-only">
              Display name
            </label>
            <Input
              id="display-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={30}
              placeholder={user?.email?.split("@")[0] ?? "your name"}
            />
            <p className="text-xs text-muted-foreground">
              2–30 characters. Letters, numbers and basic punctuation.
            </p>
          </div>
          <div className="mt-4">
            <Button
              type="button"
              disabled={!nameChanged || !nameValid || nameMutation.isPending}
              onClick={() => nameMutation.mutate(trimmed)}
            >
              {nameMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {/* Account — sign-in email + connected accounts. The two
            buttons are UI-only for now: no backend wiring exists
            for password reset or Google account linking — they
            fire a "coming soon" toast so the affordance is
            testable without dead-clicks. */}
        <div className="mt-5 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="font-heading text-base font-semibold">Account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign-in email and connected accounts.
          </p>

          {/* Email row */}
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-muted/50 p-4">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Mail className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Email
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
                {user?.email}
              </p>
            </div>
          </div>

          {/* Sign-in options. `justify-start` so the icon + label
              hug the left edge instead of centring inside a wide
              w-full button — reads like a list row. */}
          <div className="mt-4 space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() =>
                toast.info("Password reset is coming soon.")
              }
            >
              <KeyRound className="h-4 w-4" />
              Reset password
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() =>
                toast.info("Google sign-in is coming soon.")
              }
            >
              <GoogleIcon className="h-4 w-4" />
              Connect Google
            </Button>
          </div>
        </div>

        {/* Notifications card — global email opt-out + per-category
            opt-out for payouts/refunds. Both rows align on the left
            so the relationship reads as siblings; the payouts row
            still grays out when the global one is off, signalling the
            gating without nested indentation. In-app notifications
            on /notifications are not affected by either toggle. */}
        <div className="mt-5 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <h2 className="font-heading text-base font-semibold">Notifications</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose which emails you receive from LiveRush.
          </p>
          <div className="mt-4 space-y-2">
            <NotificationsToggle />
            <PayoutsNotificationsToggle />
          </div>
        </div>

        {/* Mobile-only sign out */}
        <div className="mt-6 flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await signOut();
              navigate("/", { replace: true });
            }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
    </div>
  );
}

/**
 * Inline toggle for `profiles.notifications_enabled` — controls
 * whether the user receives transactional event emails (Resend).
 * In-app notifications on /notifications are always delivered for
 * registered users; this is email-only opt-out, by product decision.
 *
 * The toggle reads its current state from the auth-context profile
 * and writes via the `set_notifications_enabled` RPC. We also honor
 * the URL hint `?notifications=off` — emails put that on their
 * unsubscribe link so clicking through from an inbox drops the
 * viewer right onto this row with the toggle already flipped.
 */
function NotificationsToggle() {
  const { profile, refreshProfile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [enabled, setEnabled] = useState(
    profile?.notifications_enabled ?? true,
  );
  const [saving, setSaving] = useState(false);

  // Sync state when the profile loads / changes.
  useEffect(() => {
    if (profile) setEnabled(profile.notifications_enabled !== false);
  }, [profile]);

  // Honor ?notifications=off deep link from email unsubscribe.
  useEffect(() => {
    if (searchParams.get("notifications") !== "off") return;
    if (!profile || profile.notifications_enabled === false) return;
    void (async () => {
      setSaving(true);
      try {
        const { error } = await supabase.rpc("set_notifications_enabled", {
          p_enabled: false,
        });
        if (error) throw error;
        await refreshProfile();
        setEnabled(false);
        toast.success("Email notifications turned off.");
      } catch (err) {
        console.warn("Auto-unsubscribe failed:", err);
      } finally {
        setSaving(false);
        const next = new URLSearchParams(searchParams);
        next.delete("notifications");
        setSearchParams(next, { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const toggle = async () => {
    const next = !enabled;
    setSaving(true);
    setEnabled(next); // optimistic
    try {
      const { error } = await supabase.rpc("set_notifications_enabled", {
        p_enabled: next,
      });
      if (error) throw error;
      await refreshProfile();
      toast.success(
        next ? "Email notifications turned on." : "Email notifications turned off.",
      );
    } catch (err) {
      setEnabled(!next); // revert
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Couldn't update notifications";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          Event updates
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          When subscribed events go live or creators you follow schedule new ones.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle email notifications"
        onClick={toggle}
        disabled={saving}
        className={cn(
          "relative h-7 w-12 flex-shrink-0 rounded-full transition-colors disabled:opacity-50",
          enabled ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all",
            enabled ? "left-6" : "left-1",
          )}
        />
      </button>
    </div>
  );
}

/**
 * Per-category toggle for payout/refund/settlement emails. Sibling
 * of NotificationsToggle and visually nested under it — disabled +
 * muted when the global toggle is off, since the global flag is the
 * master gate. Writes via the `set_payouts_notifications_enabled` RPC.
 */
function PayoutsNotificationsToggle() {
  const { profile, refreshProfile } = useAuth();
  const globalEnabled = profile?.notifications_enabled !== false;
  const [enabled, setEnabled] = useState(
    profile?.notifications_enabled_payouts ?? true,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile)
      setEnabled(profile.notifications_enabled_payouts !== false);
  }, [profile]);

  const toggle = async () => {
    if (!globalEnabled) return; // gated by master
    const next = !enabled;
    setSaving(true);
    setEnabled(next); // optimistic
    try {
      const { error } = await supabase.rpc(
        "set_payouts_notifications_enabled",
        { p_enabled: next },
      );
      if (error) throw error;
      await refreshProfile();
      toast.success(
        next
          ? "Payout & refund emails turned on."
          : "Payout & refund emails turned off.",
      );
    } catch (err) {
      setEnabled(!next); // revert
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Couldn't update payout notifications";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const effective = globalEnabled && enabled;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl bg-muted/50 p-3",
        !globalEnabled && "opacity-50",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          Payouts & refunds
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          When a bet wins, gets refunded, or a payout is on hold.
          {!globalEnabled && " Turn event updates on first."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={effective}
        aria-label="Toggle payout and refund emails"
        onClick={toggle}
        disabled={saving || !globalEnabled}
        className={cn(
          "relative h-7 w-12 flex-shrink-0 rounded-full transition-colors disabled:cursor-not-allowed",
          effective ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all",
            effective ? "left-6" : "left-1",
          )}
        />
      </button>
    </div>
  );
}

/**
 * Brand-coloured Google "G" mark. Lucide deliberately ships no
 * brand icons, so we inline the official multi-tone SVG. Sized
 * via `h-* w-*` from the parent like a Lucide icon.
 */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      aria-hidden
      focusable="false"
    >
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
