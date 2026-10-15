import { Fragment } from "react";
import { EVERYONE, tokenize } from "@/lib/format";
import { ProfileHover } from "./ProfileCard";

export function RichText({ body, myUsername }: { body: string; myUsername: string }) {
  return (
    <>
      {tokenize(body).map((t, i) => {
        switch (t.type) {
          case "text":
            return <Fragment key={i}>{t.value}</Fragment>;
          case "mention":
            // @everyone isn't a person: no card, and it's marked like a ping for you.
            if (t.username === EVERYONE) {
              return (
                <span key={i} className="rounded bg-signal/25 px-0.5 font-medium text-fg">
                  @{t.username}
                </span>
              );
            }
            return (
              <ProfileHover
                key={i}
                username={t.username}
                className={
                  t.username === myUsername
                    ? "rounded bg-signal/25 px-0.5 font-medium text-fg hover:underline"
                    : "rounded bg-raised px-0.5 font-medium text-signal hover:underline"
                }
              >
                @{t.username}
              </ProfileHover>
            );
          case "link":
            return (
              <a key={i} href={t.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="font-medium underline decoration-muted underline-offset-2 hover:decoration-fg">
                {t.href}
              </a>
            );
          case "code":
            return (
              <code key={i} className="rounded bg-raised px-1 py-0.5 font-mono text-[0.85em]">
                {t.value}
              </code>
            );
          case "codeblock":
            return (
              <pre key={i} className="scroll-thin my-1 overflow-x-auto rounded-md border border-line bg-raised p-3 font-mono text-[0.85em]">
                {t.value}
              </pre>
            );
        }
      })}
    </>
  );
}
