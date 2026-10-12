import "server-only";

/** Email through Resend's HTTP API (no SDK). Off until RESEND_API_KEY and CTRLROOM_EMAIL_FROM are both set. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.CTRLROOM_EMAIL_FROM);
}

export async function sendEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!emailConfigured()) {
    console.info(`[ctrlroom] email not configured; would send "${subject}" to ${to}`);
    return { ok: false, error: "Email isn't configured." };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.CTRLROOM_EMAIL_FROM,
        to: [to],
        subject,
        text,
        ...(process.env.CTRLROOM_SUPPORT_EMAIL ? { reply_to: process.env.CTRLROOM_SUPPORT_EMAIL } : {}),
      }),
    });
    if (!res.ok) return { ok: false, error: `Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
