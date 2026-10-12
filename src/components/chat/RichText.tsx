import { Fragment } from "react";
import { tokenize } from "@/lib/format";

export function RichText({ body, myUsername }: { body: string; myUsername: string }) {
  return (
    <>
      {tokenize(body).map((t, i) => {
        switch (t.type) {
          case "text":
            return <Fragment key={i}>{t.value}</Fragment>;
          case "mention":
            return (
              <span
                key={i}
                className={
                  t.username === myUsername
                    ? "rounded bg-signal/25 px-0.5 font-medium text-fg"
                    : "rounded bg-raised px-0.5 font-medium text-signal"
                }
              >
                @{t.username}
              </span>
            );
          case "link":
            return (
              <a key={i} href={t.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-signal underline-offset-2 hover:underline">
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
