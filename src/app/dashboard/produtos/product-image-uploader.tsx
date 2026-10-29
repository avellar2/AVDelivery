"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MAX_IMAGE_BYTES } from "@/modules/menu/constants";

export function ProductImageUploader({
  productId,
  productName,
  imageUrl,
}: {
  productId: string;
  productName: string;
  imageUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);

    if (file.size > MAX_IMAGE_BYTES) {
      setError("A imagem deve ter no máximo 2 MB.");
      return;
    }

    setPending(true);

    try {
      const formData = new FormData();
      formData.set("file", file);

      const response = await fetch(`/api/dashboard/products/${productId}/image`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Não foi possível enviar a imagem.");
        return;
      }

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      router.refresh();
    } catch {
      setError("Não foi possível enviar a imagem. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remover a imagem deste produto?")) {
      return;
    }

    setError(null);
    setPending(true);

    try {
      const response = await fetch(`/api/dashboard/products/${productId}/image`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Não foi possível remover a imagem.");
        return;
      }

      router.refresh();
    } catch {
      setError("Não foi possível remover a imagem. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative h-20 w-20 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={`Imagem de ${productName}`}
              fill
              sizes="80px"
              unoptimized
              className="object-cover"
            />
          ) : (
            <span className="grid h-full w-full place-items-center text-[10px] font-medium text-zinc-500">
              Sem foto
            </span>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <label
            htmlFor={`product-image-${productId}`}
            className="block text-sm font-medium text-zinc-700"
          >
            Imagem do produto
          </label>
          <input
            ref={inputRef}
            id={`product-image-${productId}`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={pending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void upload(file);
              }
            }}
            className="block w-full max-w-xs text-xs text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-zinc-700 disabled:opacity-60"
          />
          <p className="text-xs text-zinc-500">
            JPEG, PNG ou WebP · até 2 MB. Convertida para WebP.
          </p>
          <div className="flex items-center gap-2">
            {pending ? (
              <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
                <Spinner /> Processando...
              </span>
            ) : null}
            {imageUrl ? (
              <Button
                type="button"
                variant="ghost"
                className="px-2 py-1 text-xs text-red-600"
                onClick={() => void remove()}
                disabled={pending}
              >
                Remover imagem
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
