/** Normalize a title or slug into a url-safe package slug (max 64 chars). */
export function slugifyPackage(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'package';
}
