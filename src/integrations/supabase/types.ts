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
          influencer_id: string;
          title: string;
          description: string | null;
          cover_url: string | null;
          category: string;
          rules: string | null;
          round_format: "time" | "event";
          round_duration_sec: number | null;
          status: "scheduled" | "live" | "finished";
          scheduled_at: string;
          started_at: string | null;
          viewers_count: number;
          total_pool: number;
          created_at: string;
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
    };
  };
}
