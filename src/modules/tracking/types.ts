export type TrackingLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAt: string;
  updatedAt: string;
};

export type SharedLocation = TrackingLocation & {
  deliveryId: string;
};
