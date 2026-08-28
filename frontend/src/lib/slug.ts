// Mirrors backend/src/app/shared/slug.py's regex — keep the two in sync.
// This copy is preview-only (the catalog form's live "what will the key
// become" hint); the backend re-derives authoritatively on submit, so drift
// here would only be a cosmetic mismatch, never a correctness bug.
export function slugify(name: string, fallback = ""): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}
