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
          round_format: "time" | "event";
          round_duration_sec: number | null;
          status: "draft" | "scheduled" | "live" | "finished" | "cancelled";
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
          odds: number;
          sort_order: number;
          created_at: string;
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          role?: "user" | "influencer" | "super_admin";
          display_name?: string | null;
          avatar_url?: string | null;
          balance_cents?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      bets: {
        Row: {
          id: string;
          user_id: string;
          event_id: string;
          outcome_id: string;
          amount_cents: number;
          odds_decimal: number;
          status: "open" | "won" | "lost" | "refunded";
          payout_cents: number | null;
          placed_at: string;
          settled_at: string | null;
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
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: "welcome" | "bet_won" | "bet_lost" | "event_starting" | "new_follower" | "top_up";
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
        Args: { p_event_id: string; p_outcome_id: string; p_amount_cents: number };
        Returns: { bet_id: string; new_balance_cents: number; odds: number };
      };
      update_profile_display_name: {
        Args: { p_name: string };
        Returns: void;
      };
      update_profile_avatar_url: {
        Args: { p_avatar_url: string | null };
        Returns: void;
      };
      top_up_balance: {
        Args: { p_amount_cents: number };
        Returns: { new_balance_cents: number; amount_cents: number };
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
          p_round_format: "time" | "event";
          p_round_duration_sec: number | null;
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
          p_round_format: "time" | "event";
          p_round_duration_sec: number | null;
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
    };
  };
}
