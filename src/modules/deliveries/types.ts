import type { DeliveryStatus } from "@/types/database";
import type { OrderSummary } from "@/modules/orders/types";

export type DeliverySummary = {
  id: string;
  orderId: string;
  status: DeliveryStatus;
  driverProfileId: string;
  driverName: string;
  assignedAt: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
};

export type DeliveryEventSummary = {
  id: string;
  deliveryId: string;
  driverName: string;
  previousStatus: DeliveryStatus | null;
  status: DeliveryStatus;
  reason: string | null;
  createdAt: string;
};

export type DriverProfileSummary = {
  id: string;
  storeId: string;
  userId: string;
  displayName: string;
  phone: string | null;
  active: boolean;
  createdAt: string;
  activeDeliveries: number;
  completedDeliveries: number;
};

export type DriverStoreOption = {
  storeId: string;
  storeName: string;
  storeActive: boolean;
};

export type DriverDelivery = {
  delivery: DeliverySummary;
  order: OrderSummary;
};

export type TrackingDelivery = {
  status: DeliveryStatus;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
};
