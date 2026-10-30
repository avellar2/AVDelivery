import type {
  OrderFulfillmentType,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderStatus,
} from "@/types/database";

export type CheckoutAddress = {
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  reference: string;
  postalCode: string;
};

export type CheckoutOptionSelection = {
  groupId: string;
  optionId: string;
  quantity: number;
};

export type CheckoutItem = {
  productId: string;
  quantity: number;
  notes: string;
  options: CheckoutOptionSelection[];
};

export type CheckoutInput = {
  customerName: string;
  customerPhone: string;
  fulfillmentType: OrderFulfillmentType;
  address: CheckoutAddress | null;
  paymentMethod: OrderPaymentMethod;
  notes: string;
  items: CheckoutItem[];
};

export type CartOption = {
  groupId: string;
  groupName: string;
  optionId: string;
  name: string;
  priceCents: number;
  quantity: number;
};

export type CartLine = {
  key: string;
  productId: string;
  productName: string;
  basePriceCents: number;
  quantity: number;
  notes: string;
  options: CartOption[];
};

export type CreateOrderResult =
  | {
      ok: true;
      order: {
        orderId: string;
        orderNumber: number;
        status: OrderStatus;
        subtotalCents: number;
        deliveryFeeCents: number;
        totalCents: number;
        paymentMethod: OrderPaymentMethod;
        paymentStatus: OrderPaymentStatus;
        fulfillmentType: OrderFulfillmentType;
        created: boolean;
      };
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
      code?: string;
      minimumCents?: number;
    };

export type OrderItemOptionSummary = {
  groupName: string;
  name: string;
  additionalPriceCents: number;
  quantity: number;
};

export type OrderItemSummary = {
  id: string;
  productName: string;
  unitPriceCents: number;
  quantity: number;
  totalCents: number;
  notes: string | null;
  options: OrderItemOptionSummary[];
};

export type OrderEventSummary = {
  previousStatus: OrderStatus | null;
  status: OrderStatus;
  createdAt: string;
};

export type OrderSummary = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  paymentMethod: OrderPaymentMethod;
  fulfillmentType: OrderFulfillmentType;
  customerName: string;
  customerPhone: string;
  deliveryAddress: CheckoutAddress | null;
  notes: string | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
  items: OrderItemSummary[];
};

export type OrderDetail = OrderSummary & {
  events: OrderEventSummary[];
};

export type TrackingOrder = OrderDetail & {
  store: {
    name: string;
    slug: string;
    phone: string | null;
  };
};

export type StoreCheckoutSettings = {
  acceptingOrders: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryFeeCents: number;
  minOrderCents: number;
  paymentPixEnabled: boolean;
  paymentCashEnabled: boolean;
  paymentCardOnDeliveryEnabled: boolean;
  pixKey: string | null;
  pixReceiverName: string | null;
};

export type OrderStatusCounts = Record<OrderStatus, number>;
