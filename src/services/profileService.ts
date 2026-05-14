import { supabase } from "@/integrations/supabase/client";

export const AVATAR_MAX_BYTES = 200 * 1024; // 200 KB
export const AVATAR_ALLOWED_MIME = ["image/jpeg", "image/png"];

export async function updateDisplayName(name: string): Promise<void> {
  const { error } = await supabase.rpc("update_profile_display_name", { p_name: name });
  if (error) throw error;
}

export async function updateAvatarUrl(url: string | null): Promise<void> {
  const { error } = await supabase.rpc("update_profile_avatar_url", {
    p_avatar_url: url,
  });
  if (error) throw error;
}

export async function uploadAvatar(file: File, userId: string): Promise<string> {
  if (!AVATAR_ALLOWED_MIME.includes(file.type)) {
    throw new Error("Use a JPG or PNG file.");
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error(
      `File is too large (${(file.size / 1024).toFixed(0)} KB). Max 200 KB.`,
    );
  }

  const ext = file.type === "image/png" ? "png" : "jpg";
  const path = `${userId}/avatar-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("avatars")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type,
    });
  if (uploadErr) throw uploadErr;

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const publicUrl = data.publicUrl;

  await updateAvatarUrl(publicUrl);
  return publicUrl;
}
