/**
 * Returns a greeting string for the given name.
 * Falls back to "World" when no name is provided.
 */
export function formatGreeting(name?: string): string {
  return `Hello, ${name?.trim() || "World"}!`;
}
