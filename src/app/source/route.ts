// /source: where this install's source code lives. The AGPL asks anyone running a modified Ctrl Room for other
// people to offer them the source; set CTRLROOM_SOURCE_URL to your fork and this link (and the footer's) points there.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.redirect(process.env.CTRLROOM_SOURCE_URL || "https://github.com/claycovyn/ctrlroom", 302);
}
