import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Camera, LogOut, Wallet, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/layout/PageContainer";
import { UserPageTabs } from "@/components/layout/UserPageTabs";
import { useAuth } from "@/contexts/AuthContext";
import {
  uploadAvatar,
  updateDisplayName,
  AVATAR_MAX_BYTES,
  AVATAR_ALLOWED_MIME,
} from "@/services/profileService";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function Profile() {
  const { user, profile, refreshProfile, signOut } = useAuth();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = useState<string>(profile?.display_name ?? "");
  const initialName = profile?.display_name ?? "";

  useEffect(() => {
    setNameDraft(profile?.display_name ?? "");
  }, [profile?.display_name]);

  const balance = profile?.balance_cents ?? 0;
  const fallbackHandle =
    profile?.display_name ?? user?.email?.split("@")[0] ?? "you";
  const initials = fallbackHandle.slice(0, 2).toUpperCase();

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
    <PageContainer className="lg:pt-[18px]">
      <div className="mx-auto w-full max-w-2xl">
        <UserPageTabs />
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Manage how you appear on LiveRush.
        </p>

        {/* Header card: avatar + name + email + balance */}
        <div className="mt-6 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-full ring-2 ring-border/40"
              aria-label="Change profile photo"
            >
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={fallbackHandle}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted font-heading text-xl font-bold text-foreground">
                  {initials}
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera className="h-6 w-6 text-white" />
              </div>
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate font-heading text-lg font-bold text-foreground">
                {fallbackHandle}
              </p>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {user?.email}
              </p>
            </div>
          </div>

          {/* Balance pill */}
          <div className="mt-5 flex items-center gap-2 rounded-2xl bg-muted/50 p-2.5">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Balance</span>
            <span className="ml-auto font-heading text-base font-bold tabular-nums text-foreground">
              {dollars(balance)}
            </span>
            <Button
              asChild
              size="sm"
              variant="accent"
              className="ml-1 h-8 px-3 text-xs"
            >
              <Link to="/balance/top-up">
                <Plus className="h-3.5 w-3.5" strokeWidth={3} /> Top up
              </Link>
            </Button>
          </div>
        </div>

        {/* Photo upload card */}
        <div className="mt-5 rounded-2xl border border-border/40 bg-card p-6 shadow-sm">
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

        {/* Mobile-only sign out */}
        <div className="mt-6 flex justify-center lg:hidden">
          <Button
            type="button"
            variant="outline"
            onClick={() => void signOut()}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
