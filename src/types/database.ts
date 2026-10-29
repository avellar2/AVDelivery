export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type StoreMemberRole = "owner" | "manager" | "employee" | "driver";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      stores: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          phone: string | null;
          logo_url: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          description?: string | null;
          phone?: string | null;
          logo_url?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          phone?: string | null;
          logo_url?: string | null;
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      store_memberships: {
        Row: {
          id: string;
          store_id: string;
          user_id: string;
          role: StoreMemberRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          user_id: string;
          role?: StoreMemberRole;
          created_at?: string;
        };
        Update: {
          role?: StoreMemberRole;
        };
        Relationships: [
          {
            foreignKeyName: "store_memberships_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          user_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          created_at?: string;
        };
        Update: {
          created_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          store_id: string;
          name: string;
          description: string | null;
          sort_order: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          name: string;
          description?: string | null;
          sort_order?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          sort_order?: number;
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          store_id: string;
          category_id: string;
          name: string;
          description: string | null;
          price_cents: number;
          image_path: string | null;
          available: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          category_id: string;
          name: string;
          description?: string | null;
          price_cents: number;
          image_path?: string | null;
          available?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          category_id?: string;
          name?: string;
          description?: string | null;
          price_cents?: number;
          image_path?: string | null;
          available?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      option_groups: {
        Row: {
          id: string;
          store_id: string;
          name: string;
          min_select: number;
          max_select: number;
          required: boolean;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          name: string;
          min_select?: number;
          max_select?: number;
          required?: boolean;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          min_select?: number;
          max_select?: number;
          required?: boolean;
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_option_groups: {
        Row: {
          store_id: string;
          product_id: string;
          option_group_id: string;
          sort_order: number;
        };
        Insert: {
          store_id: string;
          product_id: string;
          option_group_id: string;
          sort_order?: number;
        };
        Update: {
          sort_order?: number;
        };
        Relationships: [];
      };
      product_options: {
        Row: {
          id: string;
          store_id: string;
          option_group_id: string;
          name: string;
          additional_price_cents: number;
          available: boolean;
          sort_order: number;
        };
        Insert: {
          id?: string;
          store_id: string;
          option_group_id: string;
          name: string;
          additional_price_cents?: number;
          available?: boolean;
          sort_order?: number;
        };
        Update: {
          name?: string;
          additional_price_cents?: number;
          available?: boolean;
          sort_order?: number;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      store_member_role: StoreMemberRole;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type StoreRow = Database["public"]["Tables"]["stores"]["Row"];
export type StoreMembershipRow = Database["public"]["Tables"]["store_memberships"]["Row"];
export type PlatformAdminRow = Database["public"]["Tables"]["platform_admins"]["Row"];
export type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
export type ProductRow = Database["public"]["Tables"]["products"]["Row"];
export type OptionGroupRow = Database["public"]["Tables"]["option_groups"]["Row"];
export type ProductOptionGroupRow = Database["public"]["Tables"]["product_option_groups"]["Row"];
export type ProductOptionRow = Database["public"]["Tables"]["product_options"]["Row"];
