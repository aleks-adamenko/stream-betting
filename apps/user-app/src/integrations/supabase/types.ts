/**
 * Supabase schema types — handwritten to match `supabase/migrations/*.sql`.
 * Keep in sync with migrations. Will be regenerable via `supabase gen types`
 * once the Supabase CLI is integrated (later phase).
 */

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      influencers: {
        Row: {
          id: string;
          handle: string;
          display_name: string;
          avatar_url: string | null;
          followers: number;
          socials: Json;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["influencers"]["Row"], "created_at"> & {
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["influencers"]["Insert"]>;
        Relationships: [];
      };
      events: {
        Row: {
          id: string;
          /** Legacy FK to the seeded `influencers` table; new studio-created
           *  events leave this null and populate `creator_id` instead. */
          influencer_id: string | null;
          /** Set on events created via studio. Null on legacy seed rows. */
          creator_id: string | null;
          title: string;
          description: string | null;
          cover_url: string | null;
          video_url: string | null;
          category: string;
          rules: string | null;
          round_format: "event" | "multi";
          /** Current round number (1-indexed). Defaults to 1 for
           *  single-round events; advance_round bumps it for
           *  multi-round events. */
          current_round: number;
          /** Set to true when the streamer clicks "Final round" on a
           *  multi-round event. No more rounds can be advanced after
           *  this; only End stream remains. */
          is_final_round: boolean;
          status:
            | "draft"
            | "scheduled"
            | "live"
            | "pending_moderation"
            | "settled"
            | "finished"
            | "cancelled";
          scheduled_at: string;
          started_at: string | null;
          viewers_count: number;
          total_pool: number;
          created_at: string;
          // Phase 6 betting metadata. All nullable so seeded rows and
          // partial drafts stay valid.
          void_conditions: string | null;
          min_bet_cents: number | null;
          max_bet_cents: number | null;
          bet_window_opens:
            | "on_live"
            | "15m_before"
            | "1h_before"
            | "24h_before"
            | null;
          bet_window_locks:
            | "manual"
            | "30s_after"
            | "1m_after"
            | "2m_after"
            | "5m_after"
            | null;
          source_type:
            | "browser_camera"
            | "external_rtmp"
            | "external_url"
            | null;
          broadcast_delay_sec: 0 | 5 | 10 | 15 | null;
          // Cloudflare Stream integration: public HLS manifest URL
          // (safe to expose). Populated by the provision-stream Edge
          // Function when the creator publishes a draft. Sensitive
          // ingest credentials (the WHIP URL with the publish secret)
          // live in `event_streams`.
          playback_url: string | null;
          // Notification dispatch idempotency stamps. Set by the
          // notify-event-live / notify-new-scheduled-event Edge
          // Functions once they've actually sent the relevant emails.
          // The events_notify_dispatch trigger guards on these so a
          // status flip / title edit can't re-fire the notification.
          live_notified_at: string | null;
          scheduled_notified_at: string | null;
          // Phase 1 betting MVP columns. Set by start_event /
          // declare_winner / settle_event / cancel_event respectively.
          betting_window_minutes: number | null;
          betting_opens_at: string | null;
          betting_closes_at: string | null;
          betting_window_closed_at: string | null;
          settled_at: string | null;
          cancelled_at: string | null;
          cancelled_reason: string | null;
          winning_outcome_ids: string[] | null;
          // Soft-delete columns. archive_event stamps these on the
          // creator's request without removing any rows; the user-app
          // feed filters on archived_at IS NULL so archived events
          // disappear from Discover/Home, but the event detail page
          // (and viewer's My Bets history) stays reachable.
          archived_at: string | null;
          archived_by: string | null;
          // Phase 2 emails idempotency stamp — set by the
          // notify-event-cancelled Edge Function after it fans out
          // refund emails to all bettors. The events_cancel_notify_dispatch
          // trigger guards on this so the fan-out can't double-fire.
          cancelled_notified_at: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["events"]["Row"], "created_at"> & {
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["events"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "events_influencer_id_fkey";
            columns: ["influencer_id"];
            referencedRelation: "influencers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "events_creator_id_fkey";
            columns: ["creator_id"];
            referencedRelation: "creator_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      creator_profiles: {
        Row: {
          id: string;
          handle: string;
          display_name: string;
          avatar_url: string | null;
          bio: string | null;
          social_links: Json;
          followers_count: number;
          status: "pending" | "verified" | "rejected";
          commission_pct: number;
          created_at: string;
          updated_at: string;
          // Admin moderation audit (Phase 1 admin app — set by
          // approve_creator / reject_creator). rejected_note carries
          // the operator's explanation back to the creator's studio
          // session so they know why and what to fix.
          rejected_note: string | null;
          moderated_by: string | null;
          moderated_at: string | null;
        };
        Insert: {
          id: string;
          handle: string;
          display_name: string;
          avatar_url?: string | null;
          bio?: string | null;
          social_links?: Json;
          followers_count?: number;
          status?: "pending" | "verified" | "rejected";
          commission_pct?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["creator_profiles"]["Insert"]>;
        Relationships: [];
      };
      event_streams: {
        Row: {
          event_id: string;
          cf_input_uid: string;
          whip_url: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["event_streams"]["Row"],
          "created_at"
        > & {
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["event_streams"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "event_streams_event_id_fkey";
            columns: ["event_id"];
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      event_chat_messages: {
        Row: {
          id: string;
          event_id: string;
          user_id: string;
          display_name: string | null;
          avatar_url: string | null;
          body: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["event_chat_messages"]["Row"],
          "id" | "created_at"
        > & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["event_chat_messages"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "event_chat_messages_event_id_fkey";
            columns: ["event_id"];
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_chat_messages_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      event_outcomes: {
        Row: {
          id: string;
          event_id: string;
          label: string;
          /** @deprecated Soft-deprecated by the pari-mutuel MVP. Reads
           *  still work for legacy events; new flow uses pool_cents. */
          odds: number;
          sort_order: number;
          created_at: string;
          // Per-outcome pari-mutuel accumulator (cents). Updated
          // atomically inside place_bet's row-locked transaction.
          pool_cents: number;
        };
        Insert: Omit<Database["public"]["Tables"]["event_outcomes"]["Row"], "created_at"> & {
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_outcomes"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "event_outcomes_event_id_fkey";
            columns: ["event_id"];
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          role: "user" | "influencer" | "super_admin";
          display_name: string | null;
          avatar_url: string | null;
          balance_cents: number;
          // Streamer-side cashable pot — added by 20260604_000002.
          // Earned-rake-only; bet winnings and top-ups land on
          // balance_cents instead. `request_payout` debits this column.
          withdrawable_cents: number;
          // Global on/off for transactional emails. Defaults true.
          // In-app notifications are not affected by this flag.
          notifications_enabled: boolean;
          // Per-category opt-out for payout / refund / settlement
          // emails. Gated by the global flag — when the global is off,
          // this flag has no effect (we don't send any emails anyway).
          notifications_enabled_payouts: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          role?: "user" | "influencer" | "super_admin";
          display_name?: string | null;
          avatar_url?: string | null;
          balance_cents?: number;
          withdrawable_cents?: number;
          notifications_enabled?: boolean;
          notifications_enabled_payouts?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      event_subscribers: {
        Row: {
          event_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: Database["public"]["Tables"]["event_subscribers"]["Row"];
        Update: Partial<
          Database["public"]["Tables"]["event_subscribers"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "event_subscribers_event_id_fkey";
            columns: ["event_id"];
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      creator_followers: {
        Row: {
          creator_id: string;
          follower_user_id: string;
          // Last time we sent a "creator scheduled / went live with a
          // new event" email to this follower. Drives the 1h throttle.
          last_notified_at: string | null;
          created_at: string;
        };
        Insert: {
          creator_id: string;
          follower_user_id: string;
          last_notified_at?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["creator_followers"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "creator_followers_creator_id_fkey";
            columns: ["creator_id"];
            referencedRelation: "creator_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      bets: {
        Row: {
          id: string;
          user_id: string;
          event_id: string;
          outcome_id: string;
          amount_cents: number;
          odds_decimal: number;
          status:
            | "open"
            | "placed"
            | "won_pending_payout"
            | "won"
            | "lost"
            | "refunded";
          payout_cents: number | null;
          placed_at: string;
          settled_at: string | null;
          // Live odds at placement time. UI/history only — settlement
          // ignores this and uses the actual pool ratios.
          odds_snapshot: number | null;
          // Client-generated UUID for idempotent retries.
          idempotency_key: string | null;
          // Per-round scoping (multi-round migration). Single-round
          // events keep this at 1; multi-round events bump it on each
          // `advance_round` so per-round pools / settlements / "one
          // bet per round" uniqueness all key off this column.
          round_index: number;
        };
        Insert: Omit<Database["public"]["Tables"]["bets"]["Row"], "id" | "placed_at"> & {
          id?: string;
          placed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["bets"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "bets_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bets_event_id_fkey";
            columns: ["event_id"];
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bets_outcome_id_fkey";
            columns: ["outcome_id"];
            referencedRelation: "event_outcomes";
            referencedColumns: ["id"];
          },
        ];
      };
      // ---- Phase 1 betting MVP tables --------------------------------
      payouts: {
        Row: {
          id: string;
          type: "winner" | "rake_streamer" | "rake_platform" | "residual" | "refund";
          recipient_id: string | null;
          recipient_kind: "viewer" | "streamer" | "platform";
          amount_cents: number;
          event_id: string;
          bet_id: string | null;
          status:
            | "pending"
            | "approved"
            | "completed"
            | "rejected"
            | "on_hold"
            | "failed";
          reject_reason: string | null;
          reject_notes: string | null;
          created_at: string;
          approved_at: string | null;
          completed_at: string | null;
          moderator_id: string | null;
          retry_count: number;
          idempotency_key: string | null;
          // Phase 2 emails idempotency stamp — set by the notify-payout
          // Edge Function once it sends the credited / rake / rejected
          // email for this payout. The payouts_notify_dispatch trigger
          // guards on this so a status flip can't re-fire the email.
          notified_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "payouts_event_id_fkey";
            columns: ["event_id"];
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_bet_id_fkey";
            columns: ["bet_id"];
            referencedRelation: "bets";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_entries: {
        Row: {
          id: string;
          account: string;
          type:
            | "deposit"
            | "bet"
            | "withdrawal"
            | "payout_pending"
            | "payout_credit"
            | "payout_reverse"
            | "refund"
            | "rake"
            | "residual"
            | "adjustment"
            // Added by 20260604_000001_ledger_rebuild.sql
            | "top_up"
            | "top_up_received"
            | "starter_grant"
            | "payout_request"
            | "payout_paid";
          amount_cents: number;
          // amount_cash_cents + event_id added by the ledger rebuild
          // migration. Null on every row written before that migration.
          amount_cash_cents: number | null;
          event_id: string | null;
          balance_after_cents: number | null;
          reference_id: string | null;
          created_at: string;
          prev_hash: string | null;
          self_hash: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      coin_packs: {
        Row: {
          id: string;
          coins: number;
          price_dollar_cents: number;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      user_bet_caps: {
        Row: {
          user_id: string;
          day: string;
          total_cents: number;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "user_bet_caps_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type:
            | "welcome"
            | "bet_won"
            | "bet_lost"
            | "event_starting"
            | "new_follower"
            | "top_up"
            // Phase 2 betting emails — companion in-app rows dropped
            // by the notify-payout / notify-event-cancelled functions.
            | "bet_refunded"
            | "rake_credited"
            | "payout_rejected"
            // 20260609_000001_in_app_toast_notifications.sql — three
            // new types fed by DB triggers on the bets / events
            // tables. Drive the top-centre toast layer (see
            // apps/user-app/src/contexts/NotificationsContext.tsx).
            | "bet_placed"
            | "event_finished"
            | "round_starting";
          title: string;
          body: string | null;
          event_id: string | null;
          read: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["notifications"]["Row"], "id" | "created_at" | "read"> & {
          id?: string;
          created_at?: string;
          read?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_event_id_fkey";
            columns: ["event_id"];
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      place_bet: {
        Args: {
          p_event_id: string;
          p_outcome_id: string;
          p_amount_cents: number;
          p_idempotency_key: string;
        };
        Returns: {
          bet_id: string;
          idempotent_replay: boolean;
          new_balance_cents: number;
          live_odds: number | null;
          total_pool_cents: number;
          outcome_pool_cents: number;
        };
      };
      compute_live_odds: {
        Args: { p_event_id: string };
        Returns: Array<{
          outcome_id: string;
          pool_cents: number;
          total_pool_cents: number;
          live_odds: number | null;
        }>;
      };
      get_event_progress: {
        Args: { p_event_id: string };
        Returns: Array<{
          unique_bettors_count: number;
          outcomes_with_bets_count: number;
          total_pool_cents: number;
          num_outcomes: number;
          min_unique_bettors: number;
          min_outcomes_with_bets: number;
          min_pool_cents: number;
          minimums_met: boolean;
        }>;
      };
      close_expired_betting_windows: {
        Args: Record<string, never>;
        Returns: {
          closed_count: number;
          closed_ids: string[];
          stale_cancelled_count: number;
          stale_cancelled_ids: string[];
          grace_minutes: number;
        };
      };
      declare_winner: {
        Args: { p_event_id: string; p_winning_outcome_ids: string[] };
        Returns: Database["public"]["Tables"]["events"]["Row"];
      };
      set_event_betting_window: {
        Args: { p_event_id: string; p_minutes: number };
        Returns: Database["public"]["Tables"]["events"]["Row"];
      };
      cancel_event: {
        Args: { p_event_id: string; p_reason?: string };
        Returns: Database["public"]["Tables"]["events"]["Row"];
      };
      get_betting_constants: {
        Args: Record<string, never>;
        Returns: Array<{
          min_bet_cents: number;
          max_bet_cents: number;
          max_odds_cap: number;
          rake_bps: number;
          rake_platform_bps: number;
          rake_streamer_bps: number;
          min_unique_bettors: number;
          min_outcomes_with_bets: number;
          betting_window_min_min: number;
          betting_window_min_max: number;
          daily_cap_cents: number;
        }>;
      };
      update_profile_display_name: {
        Args: { p_name: string };
        Returns: void;
      };
      update_profile_avatar_url: {
        Args: { p_avatar_url: string | null };
        Returns: void;
      };
      // Rebuilt by 20260604_000001_ledger_rebuild.sql — takes coins +
      // dollar cents separately so the ledger captures both sides.
      top_up_balance: {
        Args: { p_coins: number; p_cash_cents: number };
        Returns: {
          topup_id: string;
          coins_added: number;
          amount_cents: number;
          cash_cents: number;
          new_balance_cents: number;
        };
      };
      request_payout: {
        Args: { p_coins: number };
        Returns: {
          payout_id: string;
          coins: number;
          cash_cents: number;
          // Renamed by 20260604_000002 — debit now lands on
          // withdrawable_cents, not balance_cents.
          new_withdrawable_cents: number;
        };
      };
      list_coin_packs: {
        Args: Record<string, never>;
        Returns: Array<{
          id: string;
          coins: number;
          price_dollar_cents: number;
          sort_order: number;
          is_active: boolean;
          dollar_per_coin_cents: number;
          created_at: string;
          updated_at: string;
        }>;
      };
      upsert_coin_pack: {
        Args: {
          p_id: string | null;
          p_coins: number;
          p_price_dollar_cents: number;
          p_sort_order: number;
          p_is_active: boolean;
        };
        Returns: Database["public"]["Tables"]["coin_packs"]["Row"];
      };
      delete_coin_pack: {
        Args: { p_id: string };
        Returns: void;
      };
      get_platform_cash_treasury: {
        Args: Record<string, never>;
        Returns: {
          net_cash_cents: number;
          inflow_cents: number;
          outflow_cents: number;
        };
      };
      mark_notification_read: {
        Args: { p_id: string };
        Returns: void;
      };
      mark_all_notifications_read: {
        Args: Record<string, never>;
        Returns: void;
      };
      is_creator_handle_available: {
        Args: { p_handle: string };
        Returns: boolean;
      };
      complete_creator_onboarding: {
        Args: {
          p_handle: string;
          p_display_name: string;
          p_avatar_url: string | null;
          p_bio: string | null;
          p_social_links: Json;
        };
        Returns: Database["public"]["Tables"]["creator_profiles"]["Row"];
      };
      update_creator_profile: {
        Args: {
          p_handle: string;
          p_display_name: string;
          p_avatar_url: string | null;
          p_bio: string | null;
          p_social_links: Json;
        };
        Returns: Database["public"]["Tables"]["creator_profiles"]["Row"];
      };
      create_event: {
        Args: {
          p_title: string;
          p_cover_url: string | null;
          p_description: string | null;
          p_rules: string | null;
          p_category: string;
          p_round_format: "event" | "multi";
          p_scheduled_at: string;
          p_video_url: string | null;
          // Phase 6 betting/stream metadata — every new param has a server-
          // side DEFAULT NULL so omitting them keeps existing callers OK.
          p_void_conditions?: string | null;
          p_min_bet_cents?: number | null;
          p_max_bet_cents?: number | null;
          p_bet_window_opens?:
            | "on_live"
            | "15m_before"
            | "1h_before"
            | "24h_before"
            | null;
          p_bet_window_locks?:
            | "manual"
            | "30s_after"
            | "1m_after"
            | "2m_after"
            | "5m_after"
            | null;
          p_source_type?:
            | "browser_camera"
            | "external_rtmp"
            | "external_url"
            | null;
          p_broadcast_delay_sec?: 0 | 5 | 10 | 15 | null;
        };
        Returns: Database["public"]["Tables"]["events"]["Row"];
      };
      update_event: {
        Args: {
          p_event_id: string;
          p_title: string;
          p_cover_url: string | null;
          p_description: string | null;
          p_rules: string | null;
          p_category: string;
          p_round_format: "event" | "multi";
          p_scheduled_at: string;
          p_video_url: string | null;
          p_void_conditions?: string | null;
          p_min_bet_cents?: number | null;
          p_max_bet_cents?: number | null;
          p_bet_window_opens?:
            | "on_live"
            | "15m_before"
            | "1h_before"
            | "24h_before"
            | null;
          p_bet_window_locks?:
            | "manual"
            | "30s_after"
            | "1m_after"
            | "2m_after"
            | "5m_after"
            | null;
          p_source_type?:
            | "browser_camera"
            | "external_rtmp"
            | "external_url"
            | null;
          p_broadcast_delay_sec?: 0 | 5 | 10 | 15 | null;
        };
        Returns: Database["public"]["Tables"]["events"]["Row"];
      };
      delete_event: {
        Args: { p_event_id: string };
        Returns: void;
      };
      archive_event: {
        Args: { p_event_id: string };
        Returns: Database["public"]["Tables"]["events"]["Row"];
      };
      unarchive_event: {
        Args: { p_event_id: string };
        Returns: Database["public"]["Tables"]["events"]["Row"];
      };
      publish_event: {
        Args: { p_event_id: string };
        Returns: Database["public"]["Tables"]["events"]["Row"];
      };
      unpublish_event: {
        Args: { p_event_id: string };
        Returns: Database["public"]["Tables"]["events"]["Row"];
      };
      start_event: {
        Args: { p_event_id: string };
        Returns: Database["public"]["Tables"]["events"]["Row"];
      };
      finish_event: {
        Args: { p_event_id: string };
        Returns: Database["public"]["Tables"]["events"]["Row"];
      };
      send_chat_message: {
        Args: { p_event_id: string; p_body: string };
        Returns: Database["public"]["Tables"]["event_chat_messages"]["Row"];
      };
      get_stream_credentials: {
        Args: { p_event_id: string };
        // Returns a setof (table-returning function). The studio
        // unwraps `[row]` from data on success. Cloudflare's WHIP URL
        // contains the publish secret in the path — no separate
        // stream_key field is needed.
        Returns: Array<{
          whip_url: string;
          playback_url: string | null;
        }>;
      };
      subscribe_event: {
        Args: { p_event_id: string };
        Returns: Database["public"]["Tables"]["event_subscribers"]["Row"];
      };
      unsubscribe_event: {
        Args: { p_event_id: string };
        Returns: void;
      };
      get_event_subscriber_count: {
        Args: { p_event_id: string };
        Returns: number;
      };
      set_notifications_enabled: {
        Args: { p_enabled: boolean };
        Returns: void;
      };
      set_payouts_notifications_enabled: {
        Args: { p_enabled: boolean };
        Returns: void;
      };
      // Returns one row per event the calling creator owns with the
      // real bet count — bypasses the bets RLS policy that scopes
      // SELECT to the bettor's own rows.
      list_creator_event_bet_counts: {
        Args: Record<string, never>;
        Returns: Array<{
          event_id: string;
          bet_count: number;
        }>;
      };
      follow_creator: {
        Args: { p_creator_id: string };
        Returns: Database["public"]["Tables"]["creator_followers"]["Row"];
      };
      unfollow_creator: {
        Args: { p_creator_id: string };
        Returns: void;
      };
      is_following_creator: {
        Args: { p_creator_id: string };
        Returns: boolean;
      };
      get_creator_follower_count: {
        Args: { p_creator_id: string };
        Returns: number;
      };
      add_event_outcome: {
        Args: {
          p_event_id: string;
          p_label: string;
          p_odds: number;
          p_sort_order: number;
        };
        Returns: Database["public"]["Tables"]["event_outcomes"]["Row"];
      };
      update_event_outcome: {
        Args: {
          p_outcome_id: string;
          p_label: string;
          p_odds: number;
          p_sort_order: number;
        };
        Returns: Database["public"]["Tables"]["event_outcomes"]["Row"];
      };
      delete_event_outcome: {
        Args: { p_outcome_id: string };
        Returns: void;
      };
      // ---- Admin app Phase 1 (20260531_000001_admin_app.sql) ----
      // All admin RPCs are SECURITY DEFINER and gate on profiles.role =
      // 'super_admin' inside the function body. Calling them as a
      // non-admin authenticated user raises errcode 42501.
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      approve_creator: {
        Args: { p_creator_id: string };
        Returns: Database["public"]["Tables"]["creator_profiles"]["Row"];
      };
      reject_creator: {
        Args: { p_creator_id: string; p_note: string };
        Returns: Database["public"]["Tables"]["creator_profiles"]["Row"];
      };
      list_admin_users: {
        Args: Record<string, never>;
        Returns: Array<{
          id: string;
          email: string;
          role: "user" | "influencer" | "super_admin";
          // Convenience flag — true when profiles.role = 'super_admin'.
          // Drives the inline "Admin" pill next to the email.
          is_admin: boolean;
          display_name: string | null;
          avatar_url: string | null;
          // integer in Postgres — narrower than bigint but plenty for
          // cent-denominated virtual balance ceilings.
          balance_cents: number;
          // auth.users.email_confirmed_at — null until user clicks
          // the confirmation link. Drives the viewer "Email pending"
          // / "Verified" badge.
          email_confirmed_at: string | null;
          // Creator-specific fields, null when user is not a creator.
          creator_status: "pending" | "verified" | "rejected" | null;
          creator_rejected_note: string | null;
          creator_moderated_at: string | null;
          created_at: string;
        }>;
      };
      list_admin_creators: {
        Args: Record<string, never>;
        Returns: Array<{
          id: string;
          email: string;
          handle: string;
          display_name: string;
          avatar_url: string | null;
          bio: string | null;
          social_links: Json;
          followers_count: number;
          status: "pending" | "verified" | "rejected";
          commission_pct: number;
          rejected_note: string | null;
          moderated_by: string | null;
          moderated_at: string | null;
          created_at: string;
          // Per-creator activity stats — added 20260531_000001.
          events_created: number;
          events_hosted: number;
          earned_cents: number;
        }>;
      };
      list_admin_ledger: {
        Args: {
          p_limit?: number;
          p_cursor?: string | null;
        };
        Returns: Array<{
          id: string;
          account: string;
          account_role: "platform" | "event_pool" | "creator" | "viewer" | "unknown";
          account_label: string;
          account_id: string | null;
          type:
            | "deposit"
            | "bet"
            | "withdrawal"
            | "payout_pending"
            | "payout_credit"
            | "payout_reverse"
            | "refund"
            | "rake"
            | "residual"
            | "adjustment";
          amount_cents: number;
          reference_id: string | null;
          event_id: string | null;
          event_title: string | null;
          created_at: string;
        }>;
      };
      get_platform_earnings: {
        Args: Record<string, never>;
        Returns: {
          lifetime_cents: number;
          breakdown_30d: Array<{ day: string; amount_cents: number }>;
        };
      };
      // Existing settle_event / approve_payout / reject_payout RPCs
      // are now callable by super_admin in addition to service_role
      // — same args + return shapes as before.
      settle_event: {
        Args: { p_event_id: string; p_idempotency_key: string };
        Returns: {
          cancelled?: boolean;
          reason?: string;
          [key: string]: unknown;
        };
      };
      approve_payout: {
        Args: { p_payout_id: string; p_idempotency_key: string };
        Returns: {
          idempotent_replay: boolean;
          payout_id: string;
          new_balance_cents: number | null;
        };
      };
      reject_payout: {
        Args: { p_payout_id: string; p_reason: string; p_notes?: string };
        Returns: Database["public"]["Tables"]["payouts"]["Row"];
      };
    };
  };
}
