import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderTracking } from "@/components/storefront/order-tracking";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Acompanhar pedido",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ slug: string; numero: string }>;
}) {
  const { slug, numero } = await params;
  const orderNumber = Number(numero);

  if (!Number.isInteger(orderNumber) || orderNumber < 1) {
    notFound();
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">Acompanhar pedido</h1>
          <p className="text-sm text-zinc-600">
            O ambiente ainda não foi configurado para consultar pedidos.
          </p>
          <Link href="/" className="text-sm font-medium text-orange-700 hover:text-orange-800">
            Voltar ao início
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <OrderTracking storeSlug={slug} orderNumber={orderNumber} />
    </div>
  );
}
