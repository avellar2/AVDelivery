import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { z } from "zod";

import { reportServerError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/modules/auth/session";
import { MAX_IMAGE_BYTES, PRODUCT_IMAGE_BUCKET } from "@/modules/menu/constants";
import {
  buildProductImagePath,
  detectImageMime,
  getProductImageUrl,
  isAllowedImageMime,
  isProductImagePath,
} from "@/modules/menu/images";
import { getMembershipForStore } from "@/modules/memberships/service";
import { canManageMenu } from "@/modules/memberships/roles";

export const dynamic = "force-dynamic";

const idSchema = z.uuid();

type RouteContext = { params: Promise<{ id: string }> };
type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  if (!origin) {
    return true;
  }

  const allowed = new Set<string>([new URL(request.url).origin]);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");

  if (siteUrl) {
    allowed.add(siteUrl);
  }

  return allowed.has(origin);
}

async function loadManagedProduct(supabase: Client, userId: string, productId: string) {
  const { data: product, error } = await supabase
    .from("products")
    .select("id, store_id, image_path, name")
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    reportServerError("menu.image.loadProduct", error);
    return { status: 500 as const, message: "Não foi possível carregar o produto." };
  }

  if (!product) {
    return { status: 404 as const, message: "Produto não encontrado." };
  }

  const membership = await getMembershipForStore(supabase, userId, product.store_id);

  if (!membership || !canManageMenu(membership.role)) {
    return { status: 403 as const, message: "Sem permissão para alterar este produto." };
  }

  return { status: 200 as const, product };
}

async function revalidateProductPaths(supabase: Client, storeId: string) {
  revalidatePath("/dashboard/produtos");

  const { data: store } = await supabase
    .from("stores")
    .select("slug")
    .eq("id", storeId)
    .maybeSingle();

  if (store?.slug) {
    revalidatePath(`/loja/${store.slug}`);
  }
}

async function removeOldImage(
  supabase: Client,
  product: { store_id: string; id: string },
  oldPath: string,
) {
  if (!isProductImagePath(oldPath, product.store_id, product.id)) {
    return;
  }

  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([oldPath]);

  if (error) {
    reportServerError("menu.image.removeOld", error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isAllowedOrigin(request)) {
    return jsonError("Origem não permitida.", 403);
  }

  const user = await getCurrentUser();

  if (!user) {
    return jsonError("Sessão expirada.", 401);
  }

  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);

  if (!parsedId.success) {
    return jsonError("Produto inválido.", 400);
  }

  const supabase = await createSupabaseServerClient();
  const loaded = await loadManagedProduct(supabase, user.id, parsedId.data);

  if (loaded.status !== 200) {
    return jsonError(loaded.message, loaded.status);
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return jsonError("Envie um arquivo de imagem.", 400);
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return jsonError("A imagem deve ter no máximo 2 MB.", 413);
  }

  if (!isAllowedImageMime(file.type)) {
    return jsonError("Use uma imagem JPEG, PNG ou WebP.", 415);
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());
  const detectedMime = detectImageMime(inputBuffer);

  if (!detectedMime) {
    return jsonError("O conteúdo do arquivo não é uma imagem válida.", 415);
  }

  let outputBuffer: Buffer;

  try {
    outputBuffer = await sharp(inputBuffer, { failOn: "error" })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return jsonError("Não foi possível processar a imagem.", 422);
  }

  if (outputBuffer.byteLength > MAX_IMAGE_BYTES) {
    return jsonError("A imagem processada excedeu 2 MB. Tente uma imagem menor.", 413);
  }

  const imagePath = buildProductImagePath(loaded.product.store_id, loaded.product.id);
  const bucket = supabase.storage.from(PRODUCT_IMAGE_BUCKET);

  const { error: uploadError } = await bucket.upload(imagePath, outputBuffer, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });

  if (uploadError) {
    reportServerError("menu.image.upload", uploadError);
    return jsonError("Não foi possível enviar a imagem.", 500);
  }

  const { data: updated, error: updateError } = await supabase
    .from("products")
    .update({ image_path: imagePath })
    .eq("id", loaded.product.id)
    .eq("store_id", loaded.product.store_id)
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    reportServerError(
      "menu.image.updateProduct",
      updateError ?? new Error("Produto não atualizado"),
    );
    await bucket.remove([imagePath]);
    return jsonError("Não foi possível vincular a imagem ao produto.", 500);
  }

  if (loaded.product.image_path) {
    await removeOldImage(supabase, loaded.product, loaded.product.image_path);
  }

  await revalidateProductPaths(supabase, loaded.product.store_id);

  return NextResponse.json({
    imagePath,
    imageUrl: getProductImageUrl(imagePath),
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isAllowedOrigin(request)) {
    return jsonError("Origem não permitida.", 403);
  }

  const user = await getCurrentUser();

  if (!user) {
    return jsonError("Sessão expirada.", 401);
  }

  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);

  if (!parsedId.success) {
    return jsonError("Produto inválido.", 400);
  }

  const supabase = await createSupabaseServerClient();
  const loaded = await loadManagedProduct(supabase, user.id, parsedId.data);

  if (loaded.status !== 200) {
    return jsonError(loaded.message, loaded.status);
  }

  const oldPath = loaded.product.image_path;

  if (!oldPath) {
    return NextResponse.json({ imagePath: null });
  }

  if (!isProductImagePath(oldPath, loaded.product.store_id, loaded.product.id)) {
    reportServerError(
      "menu.image.invalidPath",
      new Error("Caminho de imagem fora do prefixo do produto."),
    );
    return jsonError("Caminho de imagem inválido.", 409);
  }

  const { data: updated, error: updateError } = await supabase
    .from("products")
    .update({ image_path: null })
    .eq("id", loaded.product.id)
    .eq("store_id", loaded.product.store_id)
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    reportServerError(
      "menu.image.clearProduct",
      updateError ?? new Error("Produto não atualizado"),
    );
    return jsonError("Não foi possível remover a imagem do produto.", 500);
  }

  const { error: removeError } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .remove([oldPath]);

  if (removeError) {
    reportServerError("menu.image.remove", removeError);
  }

  await revalidateProductPaths(supabase, loaded.product.store_id);

  return NextResponse.json({ imagePath: null });
}
