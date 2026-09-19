import { createHash } from "crypto";

export function toPgId(id: string | null | undefined): string {
  if (!id || typeof id !== "string") {
    return "00000000-0000-0000-0000-000000000000";
  }

  // Relaxed regex: just checks for 8-4-4-4-12 hex characters
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return id;
  }

  // Otherwise, hash the legacy Mongo ID into the Postgres UUID
  const hash = createHash("md5").update(id).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
