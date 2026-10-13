import "server-only";
import { headers } from "next/headers";
import { resolveNext } from "@/lib/authLinks";
import { siteUrl } from "@/lib/env";

/** Origins a `next` URL may point at: the configured site, and the host this request came in on. */
async function allowedOrigins(): Promise<string[]> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const local = host?.startsWith("localhost") || host?.startsWith("127.0.0.1");
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return [siteUrl(), ...(host ? [`${proto}://${host}`] : [])];
}

/** `resolveNext` against this site's origins. */
export async function linkNext(raw: unknown): Promise<string> {
  return resolveNext(raw, await allowedOrigins());
}
