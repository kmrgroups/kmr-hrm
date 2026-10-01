import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOCS_BUCKET } from "@/lib/storage";

const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** a photo / PDF for a safety record, kept private under the company's folder; null when no file was chosen */
export async function uploadSafetyFile(tenantId: string, f: FormData, key: string): Promise<string | null | { error: string }> {
  const file = f.get(key);
  if (!(file instanceof File) || file.size === 0) return null;
  const ext = TYPES[file.type]; if (!ext) return { error: "The file must be a photo (JPG / PNG) or a PDF." };
  if (file.size > 5 * 1024 * 1024) return { error: "The file must be under 5 MB." };
  const path = `${tenantId}/safety/${crypto.randomUUID()}.${ext}`;
  const { error } = await createAdminClient().storage.from(DOCS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  return error ? { error: `Upload failed: ${error.message}` } : path;
}

