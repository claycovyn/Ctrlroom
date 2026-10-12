import manifest from "../../../openctrl.json";

export const dynamic = "force-static";

/** The OPENCTRL manifest (repo root openctrl.json), so OPENCTRL can read this app's listing and Cloud limits. */
export function GET() {
  return Response.json(manifest, { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
}
