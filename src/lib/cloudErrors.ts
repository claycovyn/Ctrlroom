/**
 * Database errors that start with "CR: " are written for people (limits, takedowns, the flood guard;
 * see supabase/migrations/0003_cloud.sql). Returns the text to show, or null for any other error.
 */
export function cloudErrorText(message: string | null | undefined): string | null {
  if (!message) return null;
  const i = message.indexOf("CR: ");
  return i === -1 ? null : message.slice(i + 4).trim();
}
