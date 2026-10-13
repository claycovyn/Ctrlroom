/** The short "You're in" email sent when an owner or admin approves a join request (0008). Plain text. */
export function approvedEmail(communityName: string, url: string): { subject: string; text: string } {
  return {
    subject: `You're in ${communityName}`,
    text: `An admin approved your request to join ${communityName} on Ctrl Room.\n\nOpen it: ${url}\n\nIt's also in your list of communities next time you open Ctrl Room.\n`,
  };
}
