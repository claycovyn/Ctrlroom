import type { SupabaseClient } from "@supabase/supabase-js";

/** Storage removes at most this many paths per request. */
const CHUNK = 100;

/** The part of the Storage client this uses (a fake in tests/attachments.test.ts). */
export interface CleanupDb {
  rpc: SupabaseClient["rpc"];
  storage: { from(bucket: string): { remove(paths: string[]): Promise<{ error: { message: string } | null }> } };
}

/**
 * Daily, from the cron (service role): attachments_cleanup (0013) drops unsent files older than 24 hours and returns
 * the paths whose bytes should go (deleted messages, removed files, deleted rooms and conversations). Each chunk is
 * removed from the attachments bucket, then cleared from the queue; a chunk that fails stays queued for tomorrow.
 * Only files whose message or upload is already gone are touched, so this never deletes anything people can still see.
 */
export async function cleanupAttachments(db: CleanupDb, { rounds = 10 } = {}): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  for (let round = 0; round < rounds; round++) {
    const { data, error } = await db.rpc("attachments_cleanup", { p_limit: 500 });
    if (error) throw new Error(error.message);
    const paths = ((data ?? []) as { path: string }[]).map((r) => r.path);
    if (!paths.length) break;
    const done: string[] = [];
    for (let i = 0; i < paths.length; i += CHUNK) {
      const chunk = paths.slice(i, i + CHUNK);
      const res = await db.storage.from("attachments").remove(chunk);
      if (res.error) failed += chunk.length;
      else done.push(...chunk);
    }
    if (done.length) {
      const { error: doneError } = await db.rpc("attachments_cleanup_done", { p_paths: done });
      if (doneError) throw new Error(doneError.message);
      removed += done.length;
    }
    if (done.length < paths.length || paths.length < 500) break;
  }
  return { removed, failed };
}
