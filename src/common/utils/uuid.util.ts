import crypto from "crypto";

export function toPgId(id: string): string {
  // Relaxed regex: just checks for 8-4-4-4-12 hex characters
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return id;
  }

  // Otherwise, hash the legacy Mongo ID into the Postgres UUID
  const hash = crypto.createHash("md5").update(id).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
