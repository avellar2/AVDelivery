export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type StoreMemberRole = "owner" | "manager" | "employee" | "driver";

export type OrderStatus =
  "pending" | "accepted" | "preparing" | "ready" | "out_for_delivery" | "delivered" | "canceled";

export type OrderFulfillmentType = "delivery" | "pickup";

export type OrderPaymentMethod = "pix" | "cash" | "card_on_delivery";

export type OrderPaymentStatus = "pending" | "paid" | "canceled";

export type DeliveryStatus = "assigned" | "picked_up" | "delivered" | "canceled";

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
          accepting_orders: boolean;
          delivery_enabled: boolean;
          pickup_enabled: boolean;
          delivery_fee_cents: number;
          min_order_cents: number;
          payment_pix_enabled: boolean;
          payment_cash_enabled: boolean;
          payment_card_on_delivery_enabled: boolean;
          pix_key: string | null;
          pix_receiver_name: string | null;
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
          accepting_orders?: boolean;
          delivery_enabled?: boolean;
          pickup_enabled?: boolean;
          delivery_fee_cents?: number;
          min_order_cents?: number;
          payment_pix_enabled?: boolean;
          payment_cash_enabled?: boolean;
          payment_card_on_delivery_enabled?: boolean;
          pix_key?: string | null;
          pix_receiver_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          phone?: string | null;
          logo_url?: string | null;
          active?: boolean;
          accepting_orders?: boolean;
          delivery_enabled?: boolean;
          pickup_enabled?: boolean;
          delivery_fee_cents?: number;
          min_order_cents?: number;
          payment_pix_enabled?: boolean;
          payment_cash_enabled?: boolean;
          payment_card_on_delivery_enabled?: boolean;
          pix_key?: string | null;
          pix_receiver_name?: string | null;
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
      customers: {
        Row: {
          id: string;
          store_id: string;
          name: string;
          phone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          name: string;
          phone: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          store_id: string;
          customer_id: string | null;
          order_number: number;
          customer_name: string;
          customer_phone: string;
          fulfillment_type: OrderFulfillmentType;
          delivery_address_snapshot: Json | null;
          payment_method: OrderPaymentMethod;
          payment_status: OrderPaymentStatus;
          status: OrderStatus;
          subtotal_cents: number;
          delivery_fee_cents: number;
          total_cents: number;
          notes: string | null;
          idempotency_key: string;
          request_hash: string;
          tracking_token_hash: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          customer_id?: string | null;
          order_number: number;
          customer_name: string;
          customer_phone: string;
          fulfillment_type: OrderFulfillmentType;
          delivery_address_snapshot?: Json | null;
          payment_method: OrderPaymentMethod;
          payment_status?: OrderPaymentStatus;
          status?: OrderStatus;
          subtotal_cents: number;
          delivery_fee_cents?: number;
          total_cents: number;
          notes?: string | null;
          idempotency_key: string;
          request_hash: string;
          tracking_token_hash: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          payment_status?: OrderPaymentStatus;
          status?: OrderStatus;
          updated_at?: string;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          store_id: string;
          order_id: string;
          product_id: string | null;
          product_name_snapshot: string;
          unit_price_cents: number;
          quantity: number;
          total_cents: number;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          order_id: string;
          product_id?: string | null;
          product_name_snapshot: string;
          unit_price_cents: number;
          quantity: number;
          total_cents: number;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          notes?: string | null;
        };
        Relationships: [];
      };
      order_item_options: {
        Row: {
          id: string;
          store_id: string;
          order_item_id: string;
          option_id: string | null;
          option_group_name_snapshot: string;
          option_name_snapshot: string;
          additional_price_cents: number;
          quantity: number;
        };
        Insert: {
          id?: string;
          store_id: string;
          order_item_id: string;
          option_id?: string | null;
          option_group_name_snapshot: string;
          option_name_snapshot: string;
          additional_price_cents?: number;
          quantity?: number;
        };
        Update: {
          quantity?: number;
        };
        Relationships: [];
      };
      order_events: {
        Row: {
          id: string;
          store_id: string;
          order_id: string;
          previous_status: OrderStatus | null;
          new_status: OrderStatus;
          actor_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          order_id: string;
          previous_status?: OrderStatus | null;
          new_status: OrderStatus;
          actor_id?: string | null;
          created_at?: string;
        };
        Update: {
          actor_id?: string | null;
        };
        Relationships: [];
      };
      driver_profiles: {
        Row: {
          id: string;
          store_id: string;
          user_id: string;
          display_name: string;
          phone: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          user_id: string;
          display_name: string;
          phone?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string;
          phone?: string | null;
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      deliveries: {
        Row: {
          id: string;
          store_id: string;
          order_id: string;
          driver_profile_id: string;
          assigned_by: string | null;
          status: DeliveryStatus;
          assigned_at: string;
          picked_up_at: string | null;
          delivered_at: string | null;
          canceled_at: string | null;
          canceled_by: string | null;
          cancel_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          order_id: string;
          driver_profile_id: string;
          assigned_by?: string | null;
          status?: DeliveryStatus;
          assigned_at?: string;
          picked_up_at?: string | null;
          delivered_at?: string | null;
          canceled_at?: string | null;
          canceled_by?: string | null;
          cancel_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: DeliveryStatus;
          picked_up_at?: string | null;
          delivered_at?: string | null;
          canceled_at?: string | null;
          canceled_by?: string | null;
          cancel_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      delivery_events: {
        Row: {
          id: string;
          store_id: string;
          delivery_id: string;
          order_id: string;
          driver_profile_id: string;
          previous_status: DeliveryStatus | null;
          new_status: DeliveryStatus;
          actor_id: string | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          delivery_id: string;
          order_id: string;
          driver_profile_id: string;
          previous_status?: DeliveryStatus | null;
          new_status: DeliveryStatus;
          actor_id?: string | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          reason?: string | null;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      create_order: {
        Args: {
          p_store_slug: string;
          p_payload: Json;
          p_idempotency_key: string;
          p_request_hash: string;
          p_tracking_token_hash: string;
        };
        Returns: Json;
      };
      get_order_tracking: {
        Args: {
          p_store_slug: string;
          p_order_number: number;
          p_tracking_token_hash: string;
        };
        Returns: Json;
      };
      update_order_status: {
        Args: {
          p_order_id: string;
          p_new_status: OrderStatus;
        };
        Returns: Json;
      };
      update_order_payment_status: {
        Args: {
          p_order_id: string;
          p_new_status: OrderPaymentStatus;
        };
        Returns: Json;
      };
      create_driver: {
        Args: {
          p_store_id: string;
          p_user_id: string;
          p_display_name: string;
          p_phone: string | null;
        };
        Returns: Json;
      };
      update_driver: {
        Args: {
          p_driver_profile_id: string;
          p_display_name: string;
          p_phone: string | null;
          p_active: boolean;
        };
        Returns: Json;
      };
      assign_delivery: {
        Args: {
          p_order_id: string;
          p_driver_profile_id: string;
        };
        Returns: Json;
      };
      reassign_delivery: {
        Args: {
          p_delivery_id: string;
          p_new_driver_profile_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
      start_delivery: {
        Args: { p_delivery_id: string };
        Returns: Json;
      };
      complete_delivery: {
        Args: { p_delivery_id: string };
        Returns: Json;
      };
      cancel_delivery: {
        Args: { p_delivery_id: string; p_reason: string | null };
        Returns: Json;
      };
      share_delivery_location: {
        Args: {
          p_delivery_id: string;
          p_latitude: number;
          p_longitude: number;
          p_accuracy_meters: number;
          p_recorded_at: string;
        };
        Returns: Json;
      };
      get_driver_delivery_location: {
        Args: { p_delivery_id: string };
        Returns: Json;
      };
      clear_delivery_location: {
        Args: { p_delivery_id: string };
        Returns: Json;
      };
    };
    Enums: {
      store_member_role: StoreMemberRole;
      order_status: OrderStatus;
      order_fulfillment_type: OrderFulfillmentType;
      order_payment_method: OrderPaymentMethod;
      order_payment_status: OrderPaymentStatus;
      delivery_status: DeliveryStatus;
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
export type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];
export type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
export type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];
export type OrderItemOptionRow = Database["public"]["Tables"]["order_item_options"]["Row"];
export type OrderEventRow = Database["public"]["Tables"]["order_events"]["Row"];
export type DriverProfileRow = Database["public"]["Tables"]["driver_profiles"]["Row"];
export type DeliveryRow = Database["public"]["Tables"]["deliveries"]["Row"];
export type DeliveryEventRow = Database["public"]["Tables"]["delivery_events"]["Row"];
