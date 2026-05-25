import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Sparkles,
  Trophy,
  XCircle,
  Radio,
  Heart,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { UserPageTabs } from "@/components/layout/UserPageTabs";
import {
  useNotifications,
  notificationsKeys,
} from "@/hooks/useNotifications";
import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
  type NotificationType,
} from "@/services/notificationsService";
import { cn } from "@/lib/utils";

const TYPE_META: Record<
  NotificationType,
  { icon: typeof Bell; iconClassName: string }
> = {
  welcome: { icon: Sparkles, iconClassName: "bg-primary/10 text-primary" },
  bet_won: { icon: Trophy, iconClassName: "bg-success/15 text-success" },
  bet_lost: { icon: XCircle, iconClassName: "bg-destructive/15 text-destructive" },
  event_starting: { icon: Radio, iconClassName: "bg-primary/10 text-primary" },
  new_follower: { icon: Heart, iconClassName: "bg-pink-500/15 text-pink-600" },
  top_up: { icon: Wallet, iconClassName: "bg-success/15 text-success" },
};

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Notifications() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading } = useNotifications();

  const unreadCount = data?.filter((n) => !n.read).length ?? 0;

  const markOne = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: (id) => {
      queryClient.setQueryData<NotificationRow[]>(
        notificationsKeys.mine(),
        (prev) =>
          prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? prev,
      );
    },
  });

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: () => {
      queryClient.setQueryData<NotificationRow[]>(
        notificationsKeys.mine(),
        (prev) => prev?.map((n) => ({ ...n, read: true })) ?? prev,
      );
    },
  });

  const handleClick = (n: NotificationRow) => {
    if (!n.read) markOne.mutate(n.id);
    if (n.event_id) navigate(`/event/${n.event_id}`);
  };

  return (
    <PageContainer className="lg:pt-[18px]">
      <div className="mx-auto w-full max-w-2xl">
        <UserPageTabs />
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold sm:text-3xl">
              Notifications
            </h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              {unreadCount > 0
                ? `${unreadCount} unread`
                : "You're all caught up."}
            </p>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
            >
              Mark all read
            </Button>
          )}
        </div>

        <div className="mt-6 space-y-2">
          {isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-2xl bg-muted"
              />
            ))}

          {!isLoading && (!data || data.length === 0) && (
            <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center">
              <Bell className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-heading text-base font-semibold">
                You're all caught up
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Notifications about your bets and favorite creators will appear
                here.
              </p>
            </div>
          )}

          {data?.map((n) => {
            const meta = TYPE_META[n.type];
            const Icon = meta.icon;
            const clickable = !n.read || !!n.event_id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClick(n)}
                disabled={!clickable}
                className={cn(
                  "flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors",
                  n.read
                    ? "border-border/30 bg-card"
                    : "border-primary/30 bg-primary/[0.04]",
                  clickable && "hover:bg-secondary/40",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full",
                    meta.iconClassName,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-heading text-sm font-semibold text-foreground">
                      {n.title}
                    </p>
                    <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                      {timeAgo(n.created_at)}
                    </span>
                  </div>
                  {n.body && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {n.body}
                    </p>
                  )}
                </div>
                {!n.read && (
                  <span
                    aria-hidden
                    className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </PageContainer>
  );
}
