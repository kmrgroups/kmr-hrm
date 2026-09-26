import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const DOCS_BUCKET = "employee-docs";
export const BRANDING_BUCKET = "branding";

export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function docPath(tenantId: string, employeeId: string, ext: string) {
  return `${tenantId}/${employeeId}/${crypto.randomUUID()}.${ext}`;
}

/** Short-lived link to view a private document. Call only after a permission check. */
export async function signedDocUrl(path: string | null | undefined, seconds = 300): Promise<string | null> {
  if (!path) return null;
  const { data } = await createAdminClient().storage.from(DOCS_BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

export async function signedDocUrls(paths: string[], seconds = 300): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await createAdminClient().storage.from(DOCS_BUCKET).createSignedUrls(paths, seconds);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}

export async function downloadDoc(path: string): Promise<Uint8Array | null> {
  const { data } = await createAdminClient().storage.from(DOCS_BUCKET).download(path);
  if (!data) return null;
  return new Uint8Array(await data.arrayBuffer());
}
