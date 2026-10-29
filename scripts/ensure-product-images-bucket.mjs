import { createAdminClient, fail } from "./lib/admin.mjs";

const BUCKET = "product-images";
const FILE_SIZE_LIMIT = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

const supabase = createAdminClient();

const { data: existing, error: getError } = await supabase.storage.getBucket(BUCKET);

if (getError && !/not found/i.test(getError.message)) {
  fail(`Não foi possível consultar o bucket ${BUCKET}: ${getError.message}`);
}

const options = {
  public: true,
  fileSizeLimit: FILE_SIZE_LIMIT,
  allowedMimeTypes: ALLOWED_MIME_TYPES,
};

if (existing) {
  const { error } = await supabase.storage.updateBucket(BUCKET, options);

  if (error) {
    fail(`Não foi possível atualizar o bucket ${BUCKET}: ${error.message}`);
  }
} else {
  const { error } = await supabase.storage.createBucket(BUCKET, options);

  if (error) {
    fail(`Não foi possível criar o bucket ${BUCKET}: ${error.message}`);
  }
}

console.log(
  `\n[ok] Bucket ${BUCKET} ${existing ? "atualizado" : "criado"}: public=true, limite=2 MB, MIME=image/jpeg,image/png,image/webp.\n`,
);
