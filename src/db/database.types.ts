/**
 * Supabase database types for supabase/migrations.
 * Hand-written to match the schema; regenerate with `npm run db:types` once a local
 * Supabase (Docker) or a linked project is available — the shapes must stay identical.
 */
import type { ShopState } from '../domain/types.js';

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MemberRole = 'owner' | 'manager' | 'staff';

export interface CommitResult {
  status: 'committed' | 'conflict' | 'replayed';
  revision: number;
}

export interface Database {
  public: {
    Tables: {
      shops: {
        Row: { id: string; name: string; created_at: string };
        Insert: { id?: string; name: string; created_at?: string };
        Update: { name?: string };
        Relationships: [];
      };
      shop_members: {
        Row: {
          shop_id: string;
          user_id: string;
          role: MemberRole;
          display_name: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          shop_id: string;
          user_id: string;
          role: MemberRole;
          display_name: string;
          active?: boolean;
          created_at?: string;
        };
        Update: { role?: MemberRole; display_name?: string; active?: boolean };
        Relationships: [];
      };
      shop_state: {
        Row: {
          shop_id: string;
          revision: number;
          data: ShopState;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: { shop_id: string; revision: number; data: ShopState; updated_by?: string | null };
        Update: { revision?: number; data?: ShopState; updated_by?: string | null };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: number;
          shop_id: string;
          actor_id: string | null;
          actor_role: MemberRole | null;
          action: string;
          payload: Json;
          revision_before: number | null;
          revision_after: number | null;
          at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      idempotency_keys: {
        Row: {
          shop_id: string;
          key: string;
          action: string;
          revision_after: number;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      evidence: {
        Row: {
          id: string;
          shop_id: string;
          object_path: string;
          sha256: string;
          mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
          size_bytes: number;
          original_name: string;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          shop_id: string;
          object_path: string;
          sha256: string;
          mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
          size_bytes: number;
          original_name: string;
          uploaded_by?: string | null;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      bootstrap_shop: {
        Args: {
          p_owner: string;
          p_shop_name: string;
          p_display_name: string;
          p_initial: ShopState;
        };
        Returns: string;
      };
      commit_shop_action: {
        Args: {
          p_shop: string;
          p_actor: string;
          p_role: MemberRole;
          p_action: string;
          p_payload: Json;
          p_expected_revision: number;
          p_next: ShopState;
          p_idempotency_key?: string | null;
        };
        Returns: CommitResult;
      };
      shop_role: { Args: { p_shop: string }; Returns: MemberRole | null };
      is_shop_member: { Args: { p_shop: string }; Returns: boolean };
      is_shop_reviewer: { Args: { p_shop: string }; Returns: boolean };
    };
    Enums: { member_role: MemberRole };
    CompositeTypes: Record<string, never>;
  };
}
