import { z } from "zod";

export const deliveryIdSchema = z.uuid("Entrega inválida.");

export const shareLocationSchema = z.object({
  deliveryId: deliveryIdSchema,
  latitude: z.number().finite().gte(-90, "Latitude inválida.").lte(90, "Latitude inválida."),
  longitude: z.number().finite().gte(-180, "Longitude inválida.").lte(180, "Longitude inválida."),
  accuracyMeters: z
    .number()
    .finite()
    .positive("Precisão inválida.")
    .lte(20_000, "Precisão inválida."),
  recordedAt: z.iso.datetime({ offset: true }),
});

export type ShareLocationInput = z.input<typeof shareLocationSchema>;

export function isValidIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
