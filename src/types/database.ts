export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type StoreMemberRole = "owner" | "manager" | "employee" | "driver";

export type OrderStatus =
  "pending" | "accepted" | "preparing" | "ready" | "out_for_delivery" | "delivered" | "canceled";

export type OrderFulfillmentType = "delivery" | "pickup";

export type OrderPaymentMethod = "pix" | "cash" | "card_on_delivery";

export type OrderPaymentStatus = "pending" | "paid" | "canceled";

export type DeliveryStatus = "assigned" | "picked_up" | "delivered" | "canceled";

export type BillingInterval = "monthly";

export type SubscriptionStatus = "trialing" | "active" | "grace" | "expired" | "canceled";

export type InvoiceStatus = "pending" | "paid" | "overdue" | "canceled" | "refunded" | "chargeback";

export type CommercialState =
  "missing" | "inactive" | "trialing" | "active" | "grace" | "exempt" | "expired" | "canceled";

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
      plans: {
        Row: {
          id: string;
          code: string;
          name: string;
          price_cents: number;
          currency: string;
          billing_interval: BillingInterval;
          trial_days: number;
          grace_days: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          name: string;
          price_cents: number;
          currency?: string;
          billing_interval?: BillingInterval;
          trial_days?: number;
          grace_days?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          name?: string;
          price_cents?: number;
          currency?: string;
          billing_interval?: BillingInterval;
          trial_days?: number;
          grace_days?: number;
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          store_id: string;
          plan_id: string;
          status: SubscriptionStatus;
          is_exempt: boolean;
          exemption_reason: string | null;
          trial_started_at: string | null;
          trial_ends_at: string | null;
          current_period_start: string | null;
          current_period_end: string | null;
          grace_ends_at: string | null;
          canceled_at: string | null;
          external_provider: string | null;
          external_subscription_id: string | null;
          external_status: string | null;
          last_synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          plan_id: string;
          status?: SubscriptionStatus;
          is_exempt?: boolean;
          exemption_reason?: string | null;
          trial_started_at?: string | null;
          trial_ends_at?: string | null;
          current_period_start?: string | null;
          current_period_end?: string | null;
          grace_ends_at?: string | null;
          canceled_at?: string | null;
          external_provider?: string | null;
          external_subscription_id?: string | null;
          external_status?: string | null;
          last_synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          plan_id?: string;
          status?: SubscriptionStatus;
          is_exempt?: boolean;
          exemption_reason?: string | null;
          trial_started_at?: string | null;
          trial_ends_at?: string | null;
          current_period_start?: string | null;
          current_period_end?: string | null;
          grace_ends_at?: string | null;
          canceled_at?: string | null;
          external_provider?: string | null;
          external_subscription_id?: string | null;
          external_status?: string | null;
          last_synced_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      invoices: {
        Row: {
          id: string;
          store_id: string;
          subscription_id: string;
          amount_cents: number;
          currency: string;
          status: InvoiceStatus;
          period_start: string;
          period_end: string;
          due_at: string;
          paid_at: string | null;
          external_provider: string | null;
          external_reference: string | null;
          external_payment_id: string | null;
          billing_type: string | null;
          external_status: string | null;
          payment_url: string | null;
          pix_payload: string | null;
          external_created_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          subscription_id: string;
          amount_cents: number;
          currency?: string;
          status?: InvoiceStatus;
          period_start: string;
          period_end: string;
          due_at: string;
          paid_at?: string | null;
          external_provider?: string | null;
          external_reference?: string | null;
          external_payment_id?: string | null;
          billing_type?: string | null;
          external_status?: string | null;
          payment_url?: string | null;
          pix_payload?: string | null;
          external_created_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          currency?: string;
          status?: InvoiceStatus;
          period_start?: string;
          period_end?: string;
          due_at?: string;
          paid_at?: string | null;
          external_provider?: string | null;
          external_reference?: string | null;
          external_payment_id?: string | null;
          billing_type?: string | null;
          external_status?: string | null;
          payment_url?: string | null;
          pix_payload?: string | null;
          external_created_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      subscription_events: {
        Row: {
          id: string;
          subscription_id: string;
          store_id: string;
          event_type: string;
          actor_id: string | null;
          reason: string | null;
          metadata: Json;
          dedupe_key: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          subscription_id: string;
          store_id: string;
          event_type: string;
          actor_id?: string | null;
          reason?: string | null;
          metadata?: Json;
          dedupe_key?: string | null;
          created_at?: string;
        };
        Update: {
          event_type?: string;
          reason?: string | null;
          metadata?: Json;
          dedupe_key?: string | null;
        };
        Relationships: [];
      };
      billing_customers: {
        Row: {
          id: string;
          store_id: string;
          provider: string;
          legal_name: string;
          document: string;
          email: string;
          phone: string;
          postal_code: string | null;
          address: string | null;
          address_number: string | null;
          complement: string | null;
          province: string | null;
          external_customer_id: string | null;
          external_status: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          provider?: string;
          legal_name: string;
          document: string;
          email: string;
          phone: string;
          postal_code?: string | null;
          address?: string | null;
          address_number?: string | null;
          complement?: string | null;
          province?: string | null;
          external_customer_id?: string | null;
          external_status?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          legal_name?: string;
          document?: string;
          email?: string;
          phone?: string;
          postal_code?: string | null;
          address?: string | null;
          address_number?: string | null;
          complement?: string | null;
          province?: string | null;
          external_customer_id?: string | null;
          external_status?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      billing_webhook_events: {
        Row: {
          id: string;
          provider: string;
          external_event_id: string;
          event_type: string;
          resource_type: string | null;
          resource_id: string | null;
          payload: Json;
          status: string;
          attempts: number;
          last_error: string | null;
          received_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          provider?: string;
          external_event_id: string;
          event_type: string;
          resource_type?: string | null;
          resource_id?: string | null;
          payload: Json;
          status?: string;
          attempts?: number;
          last_error?: string | null;
          received_at?: string;
          processed_at?: string | null;
        };
        Update: {
          status?: string;
          attempts?: number;
          last_error?: string | null;
          processed_at?: string | null;
        };
        Relationships: [];
      };
      billing_checkout_requests: {
        Row: {
          id: string;
          store_id: string;
          subscription_id: string;
          provider: string;
          request_id: string;
          status: string;
          external_subscription_id: string | null;
          first_payment_id: string | null;
          payment_url: string | null;
          pix_payload: string | null;
          error_message: string | null;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          subscription_id: string;
          provider?: string;
          request_id: string;
          status?: string;
          external_subscription_id?: string | null;
          first_payment_id?: string | null;
          payment_url?: string | null;
          pix_payload?: string | null;
          error_message?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: string;
          external_subscription_id?: string | null;
          first_payment_id?: string | null;
          payment_url?: string | null;
          pix_payload?: string | null;
          error_message?: string | null;
          expires_at?: string | null;
          updated_at?: string;
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
      get_store_commercial_status: {
        Args: { p_store_slug: string };
        Returns: Json;
      };
      get_store_subscription: {
        Args: { p_store_id: string };
        Returns: Json;
      };
      admin_list_store_billing: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          store_id: string;
          name: string;
          slug: string;
          active: boolean;
          created_at: string;
          member_count: number;
          owner_count: number;
          subscription_id: string | null;
          status: SubscriptionStatus | null;
          is_exempt: boolean | null;
          plan_id: string | null;
          plan_name: string | null;
          price_cents: number | null;
          currency: string | null;
          trial_started_at: string | null;
          trial_ends_at: string | null;
          current_period_start: string | null;
          current_period_end: string | null;
          grace_ends_at: string | null;
          canceled_at: string | null;
          effective_state: string;
        }>;
      };
      admin_create_store: {
        Args: {
          p_name: string;
          p_slug: string;
          p_description: string | null;
          p_phone: string | null;
          p_plan_id: string;
          p_owner_user_id: string;
          p_start_trial: boolean;
          p_request_id: string | null;
        };
        Returns: Json;
      };
      admin_add_store_owner: {
        Args: {
          p_store_id: string;
          p_user_id: string;
          p_reason: string;
          p_request_id: string | null;
        };
        Returns: Json;
      };
      admin_update_store: {
        Args: {
          p_store_id: string;
          p_name: string;
          p_description: string | null;
          p_phone: string | null;
          p_active: boolean;
          p_reason: string | null;
          p_request_id: string | null;
        };
        Returns: Json;
      };
      admin_update_subscription: {
        Args: {
          p_store_id: string;
          p_action: string;
          p_days: number | null;
          p_plan_id: string | null;
          p_reason: string;
          p_request_id: string | null;
        };
        Returns: Json;
      };
      owner_get_billing_profile: {
        Args: { p_store_id: string };
        Returns: Json;
      };
      owner_upsert_billing_profile: {
        Args: {
          p_store_id: string;
          p_legal_name: string;
          p_document: string;
          p_email: string;
          p_phone: string;
          p_postal_code?: string | null;
          p_address?: string | null;
          p_address_number?: string | null;
          p_complement?: string | null;
          p_province?: string | null;
        };
        Returns: Json;
      };
      billing_bind_customer: {
        Args: {
          p_store_id: string;
          p_provider: string;
          p_external_customer_id: string;
        };
        Returns: Json;
      };
      billing_begin_checkout: {
        Args: { p_store_id: string; p_request_id: string };
        Returns: Json;
      };
      billing_complete_checkout: {
        Args: {
          p_store_id: string;
          p_request_id: string;
          p_external_subscription_id: string;
          p_external_status: string;
          p_payment_id: string | null;
          p_payment_url: string | null;
          p_pix_payload: string | null;
          p_amount_cents: number | null;
          p_due_date: string | null;
          p_billing_type: string | null;
        };
        Returns: Json;
      };
      billing_fail_checkout: {
        Args: {
          p_store_id: string;
          p_request_id: string;
          p_error: string;
        };
        Returns: void;
      };
      billing_apply_payment_event: {
        Args: {
          p_provider: string;
          p_event_id: string | null;
          p_event_type: string | null;
          p_payment_id: string;
          p_external_subscription_id: string;
          p_external_customer_id: string;
          p_external_status: string;
          p_amount_cents: number;
          p_currency: string;
          p_due_date: string;
          p_paid_at: string | null;
          p_payment_url: string | null;
          p_billing_type: string | null;
          p_payload: Json;
        };
        Returns: Json;
      };
      billing_update_external_subscription_status: {
        Args: {
          p_external_subscription_id: string;
          p_external_status: string;
          p_event_id: string | null;
          p_payload: Json;
        };
        Returns: Json;
      };
      billing_reconciliation_candidates: {
        Args: { p_limit?: number };
        Returns: Array<{
          store_id: string;
          subscription_id: string;
          external_subscription_id: string;
          external_status: string | null;
          last_synced_at: string | null;
          next_due_at: string | null;
        }>;
      };
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
      billing_interval: BillingInterval;
      subscription_status: SubscriptionStatus;
      invoice_status: InvoiceStatus;
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
export type PlanRow = Database["public"]["Tables"]["plans"]["Row"];
export type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];
export type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
export type SubscriptionEventRow = Database["public"]["Tables"]["subscription_events"]["Row"];
export type BillingCustomerRow = Database["public"]["Tables"]["billing_customers"]["Row"];
export type BillingWebhookEventRow = Database["public"]["Tables"]["billing_webhook_events"]["Row"];
export type BillingCheckoutRequestRow =
  Database["public"]["Tables"]["billing_checkout_requests"]["Row"];
