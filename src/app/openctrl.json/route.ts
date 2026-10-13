import manifest from "../../../openctrl.json";

export const dynamic = "force-static";

/** The OpenCtrl manifest (repo root openctrl.json), so OpenCtrl can read this app's listing and Cloud limits. */
export function GET() {
  return Response.json(manifest, { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
}
