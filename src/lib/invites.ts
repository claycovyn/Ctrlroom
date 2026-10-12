/** Accepts a bare code or a full invite link. */
export function inviteCodeFrom(input: string): string {
  const s = input.trim();
  const m = s.match(/\/invite\/([A-Za-z0-9_-]+)/);
  return (m ? m[1] : s).replace(/[^A-Za-z0-9_-]/g, "");
}

export function friendlyJoinError(message: string): string {
  if (message.includes("not found")) return "That invite doesn't exist. Check the link.";
  if (message.includes("expired")) return "That invite has expired. Ask for a new one.";
  if (message.includes("used up")) return "That invite has been used up. Ask for a new one.";
  if (message.includes("cannot join")) return "You can't join this community.";
  return message;
}
