import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AtSign,
  Camera,
  CheckCircle2,
  Instagram,
  Loader2,
  Twitch,
  Youtube,
  Zap,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";

import { Button, Input } from "@liverush/ui";
import { cn } from "@liverush/lib";
import { AuthLayout, AuthTitle } from "@/components/AuthLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const AVATAR_MAX_BYTES = 200 * 1024; // 200 KB — matches user-app's profile photo limit
const AVATAR_ALLOWED_MIME = ["image/jpeg", "image/png"];

type Step = 1 | 2 | 3;

/** Normalize a display name into a valid handle candidate: lowercase,
 *  spaces → underscores, strip non-[a-z0-9_], cap at 20 chars. */
function handleFromDisplayName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 20);
}

/** Produce N candidate handles based on `base` with 1–3 random digits
 *  appended. Truncates the base so the result still fits in 20 chars. */
function suggestionsFor(base: string, count = 3): string[] {
  const out = new Set<string>();
  while (out.size < count) {
    const digits = Math.floor(Math.random() * 900) + 10; // 10-909 → mostly 2-3 digits
    const suffix = `_${digits}`;
    const trimmed = base.slice(0, 20 - suffix.length);
    if (trimmed.length >= 1) out.add(`${trimmed}${suffix}`);
    if (out.size > 50) break; // safety
  }
  return Array.from(out);
}

export default function CreatorOnboarding() {
  const navigate = useNavigate();
  const { user, refreshCreator } = useAuth();
  const [step, setStep] = useState<Step>(1);

  // Form state
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [instagram, setInstagram] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [youtube, setYoutube] = useState("");

  // Tracks whether the user has manually typed in the handle field. If
  // they haven't, we keep the handle auto-derived from the display name.
  const [handleEdited, setHandleEdited] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const [handleStatus, setHandleStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pre-fill display name + avatar from the user-app profiles row, if the
  // user has one. Lets a returning consumer skip retyping their name and
  // reuse the avatar they've already uploaded on the consumer side.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.display_name) {
          setDisplayName((prev) => prev || data.display_name);
        }
        if (data?.avatar_url) {
          // Only pre-fill if the user hasn't already picked a new file
          // (their selection takes precedence).
          setAvatarPreview((prev) => prev || data.avatar_url);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Auto-derive the handle from the display name while the user hasn't
  // manually touched the handle input.
  useEffect(() => {
    if (handleEdited) return;
    const derived = handleFromDisplayName(displayName);
    setHandle(derived);
  }, [displayName, handleEdited]);

  // Debounced handle availability lookup
  useEffect(() => {
    const trimmed = handle.trim().toLowerCase();
    if (!trimmed) {
      setHandleStatus("idle");
      setSuggestions([]);
      return;
    }
    if (!HANDLE_RE.test(trimmed)) {
      setHandleStatus("invalid");
      setSuggestions([]);
      return;
    }
    setHandleStatus("checking");
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc("is_creator_handle_available", {
        p_handle: trimmed,
      });
      if (error) {
        console.warn("handle check failed", error);
        setHandleStatus("idle");
        return;
      }
      if (data) {
        setHandleStatus("available");
        setSuggestions([]);
      } else {
        setHandleStatus("taken");
        setSuggestions(suggestionsFor(trimmed, 3));
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [handle]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
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
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  // Bullet validation per step before letting the user advance.
  const step1Ready =
    handleStatus === "available" &&
    displayName.trim().length >= 2 &&
    displayName.trim().length <= 40;
  const step2Ready = step1Ready; // avatar + bio + socials all optional

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      let avatarUrl: string | null = null;
      if (avatarFile) {
        // A new file was picked → upload to creator-assets.
        const ext = avatarFile.name.split(".").pop()?.toLowerCase() ?? "jpg";
        const path = `${user.id}/avatar-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("creator-assets")
          .upload(path, avatarFile, {
            cacheControl: "3600",
            upsert: true,
            contentType: avatarFile.type,
          });
        if (upErr) throw upErr;
        const { data } = supabase.storage
          .from("creator-assets")
          .getPublicUrl(path);
        avatarUrl = data.publicUrl;
      } else if (avatarPreview && !avatarPreview.startsWith("blob:")) {
        // No new file, but the user-app already had an avatar — reuse it.
        // (Local previews are blob:// URLs; reused URLs are https://.)
        avatarUrl = avatarPreview;
      }

      const socialLinks: Record<string, string> = {};
      if (instagram.trim()) socialLinks.instagram = instagram.trim();
      if (tiktok.trim()) socialLinks.tiktok = tiktok.trim();
      if (youtube.trim()) socialLinks.youtube = youtube.trim();

      const { error } = await supabase.rpc("complete_creator_onboarding", {
        p_handle: handle.trim().toLowerCase(),
        p_display_name: displayName.trim(),
        p_avatar_url: avatarUrl,
        p_bio: bio.trim() || null,
        p_social_links: socialLinks,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refreshCreator();
      toast.success("Creator profile created", {
        description: "Your account is under review. You can draft events while you wait.",
      });
      navigate("/", { replace: true });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Onboarding failed";
      setError(message);
      toast.error(message);
    },
  });

  const goNext = () => {
    setError(null);
    if (step === 1 && !step1Ready) {
      setError("Pick an available handle and a 2-40 character display name first.");
      return;
    }
    if (step < 3) setStep((step + 1) as Step);
  };

  const goBack = () => {
    setError(null);
    if (step > 1) setStep((step - 1) as Step);
  };

  return (
    <AuthLayout className="max-w-lg">
      <AuthTitle subtitle="Three quick steps and you're ready to draft your first event.">
        Set up your creator profile
      </AuthTitle>

      <Stepper current={step} />

      {step === 1 && (
        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <label htmlFor="display-name" className="text-sm font-medium">
              Display name
            </label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              minLength={2}
              maxLength={40}
              placeholder="The name your audience sees"
              className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="handle" className="text-sm font-medium">
              ID
            </label>
            <div className="relative">
              <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
              <Input
                id="handle"
                value={handle}
                onChange={(e) => {
                  setHandle(e.target.value.toLowerCase());
                  setHandleEdited(true);
                }}
                required
                minLength={3}
                maxLength={20}
                placeholder="your_id"
                className="border-white/20 bg-white/10 pl-9 text-white placeholder:text-white/40"
              />
            </div>
            <HandleStatusLine status={handleStatus} value={handle} />
            {handleStatus === "taken" && suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-white/65">Try:</span>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setHandle(s);
                      setHandleEdited(true);
                    }}
                    className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-6 space-y-5">
          <div className="space-y-3">
            <label className="text-sm font-medium">Avatar</label>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-full ring-2 ring-white/20"
              >
                {avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt="Avatar preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/10 text-white/70">
                    <Camera className="h-6 w-6" />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Camera className="h-5 w-5 text-white" />
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <div className="min-w-0 flex-1 text-sm text-white/75">
                <p>JPG or PNG, max 200 KB.</p>
                <p className="text-xs text-white/55">Square images look best.</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="bio" className="text-sm font-medium">
              Bio <span className="text-white/55">(optional)</span>
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 280))}
              rows={3}
              placeholder="Tell your audience what they'll find on your channel."
              className="flex w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            />
            <p className="text-[11px] text-white/55">{bio.length}/280</p>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">
              Socials <span className="text-white/55">(optional)</span>
            </label>
            <SocialInput
              icon={Instagram}
              placeholder="@your_handle"
              value={instagram}
              onChange={setInstagram}
            />
            <SocialInput
              icon={Twitch}
              placeholder="@tiktok_handle"
              value={tiktok}
              onChange={setTiktok}
            />
            <SocialInput
              icon={Youtube}
              placeholder="youtube.com/@channel"
              value={youtube}
              onChange={setYoutube}
            />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-6 space-y-4 text-sm">
          <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-4">
            <div className="flex items-center gap-3">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt=""
                  className="h-12 w-12 rounded-full object-cover ring-2 ring-white/20"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white/60">
                  <Camera className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0">
                <p className="font-heading text-base font-bold text-white">
                  {displayName || "Your display name"}
                </p>
                <p className="text-xs text-white/60">@{handle || "your_handle"}</p>
              </div>
            </div>
            {bio && (
              <p className="mt-3 text-sm leading-relaxed text-white/80">{bio}</p>
            )}
            {(instagram || tiktok || youtube) && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/70">
                {instagram && <Pill icon={Instagram}>{instagram}</Pill>}
                {tiktok && <Pill icon={Twitch}>{tiktok}</Pill>}
                {youtube && <Pill icon={Youtube}>{youtube}</Pill>}
              </div>
            )}
          </div>
          <p className="text-xs leading-relaxed text-white/70">
            Your profile starts in <span className="font-semibold text-white">Pending review</span>.
            You can already draft events and prepare outcomes — publishing unlocks
            once we verify your account.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-destructive/30 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center gap-3">
        {step > 1 ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={goBack}
            disabled={submitMutation.isPending}
            className="gap-2 border-white/30 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        ) : null}
        {step < 3 ? (
          <Button
            type="button"
            size="lg"
            onClick={goNext}
            disabled={!step1Ready}
            className="ml-auto gap-2 text-base text-[#1F2679] ring-0 hover:text-[#1F2679]"
            style={{ backgroundColor: "#FEE53A", backgroundImage: "none" }}
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            onClick={() => submitMutation.mutate()}
            disabled={!step2Ready || submitMutation.isPending}
            className="ml-auto gap-2 text-base text-[#1F2679] ring-0 hover:text-[#1F2679]"
            style={{ backgroundColor: "#FEE53A", backgroundImage: "none" }}
          >
            {submitMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Create profile <Zap className="h-4 w-4 fill-current" />
              </>
            )}
          </Button>
        )}
      </div>
    </AuthLayout>
  );
}

function Stepper({ current }: { current: Step }) {
  return (
    <div className="mt-6 flex items-center justify-center gap-2 text-xs">
      {[1, 2, 3].map((n) => {
        const active = n === current;
        const done = n < current;
        return (
          <div
            key={n}
            className={cn(
              "flex h-7 min-w-7 items-center justify-center rounded-full px-2 font-semibold",
              done && "bg-[#FEE53A] text-[#1F2679]",
              active && "bg-white text-[#1F2679]",
              !done && !active && "bg-white/10 text-white/55",
            )}
          >
            {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
          </div>
        );
      })}
    </div>
  );
}

function HandleStatusLine({
  status,
  value,
}: {
  status: "idle" | "checking" | "available" | "taken" | "invalid";
  value: string;
}) {
  if (!value) {
    return (
      <p className="text-[11px] text-white/55">
        Letters, numbers, underscore. 3–20 characters.
      </p>
    );
  }
  if (status === "checking") return <p className="text-[11px] text-white/55">Checking…</p>;
  if (status === "invalid")
    return <p className="text-[11px] text-destructive-foreground">Invalid format</p>;
  if (status === "available")
    return <p className="text-[11px] text-emerald-300">Available ✓</p>;
  if (status === "taken")
    return <p className="text-[11px] text-destructive-foreground">Already taken</p>;
  return null;
}

function SocialInput({
  icon: Icon,
  placeholder,
  value,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-white/20 bg-white/10 pl-9 text-white placeholder:text-white/40"
      />
    </div>
  );
}

function Pill({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1">
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}
