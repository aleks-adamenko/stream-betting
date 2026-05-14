import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
export type NotificationType = NotificationRow["type"];

export async function listNotifications(): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, user_id, type, title, body, event_id, read, created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
  if (error) throw error;
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase.rpc("mark_all_notifications_read");
  if (error) throw error;
}
