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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
