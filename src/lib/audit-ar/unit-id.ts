// Unit numbers are the global business identity but may contain "/", spaces, etc.
// Firestore doc IDs cannot contain "/" and must avoid leading/trailing whitespace,
// so we derive a deterministic, collision-safe, human-readable doc ID from the raw
// unit number instead of using it verbatim.

/** Normalized form used for exact-match queries and uniqueness (trim + collapse spaces + upper). */
export function normalizeUnitNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Human-readable slug, e.g. "Blok A/12" -> "blok-a-12". */
export function slugifyUnitNumber(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Small deterministic 32-bit hash rendered in base36 (no Date/Math.random — stable across runs). */
function shortHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Deterministic Firestore doc ID for a unit. The slug keeps the ID browsable in
 * the console; the hash of the normalized number guarantees uniqueness even when
 * two different raw numbers slug to the same string.
 */
export function unitIdFromNumber(raw: string): string {
  const norm = normalizeUnitNumber(raw);
  const slug = slugifyUnitNumber(raw) || "unit";
  return `${slug}__${shortHash(norm)}`;
}
