import { Fragment } from "react";
import { tokenize } from "@/lib/format";

/** Plain text with links made clickable (the message linkifier); everything else stays exactly as typed. */
export function LinkedText({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  for (const t of tokenize(text)) {
    if (t.type !== "link") continue;
    const at = rest.indexOf(t.href);
    if (at === -1) continue;
    if (at > 0) out.push(<Fragment key={key++}>{rest.slice(0, at)}</Fragment>);
    out.push(
      <a key={key++} href={t.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all font-medium underline decoration-muted underline-offset-2 hover:decoration-fg">
        {t.href}
      </a>,
    );
    rest = rest.slice(at + t.href.length);
  }
  if (rest) out.push(<Fragment key={key++}>{rest}</Fragment>);
  return <>{out}</>;
}
