// QA harness: next/link. Like Next's: the caller's onClick runs first and a preventDefault there stops the
// navigation; modified clicks are left to the browser.
import { useRouter } from "./navigation";

type Props = { href: string; children?: React.ReactNode; prefetch?: boolean | null; replace?: boolean; scroll?: boolean } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
>;

export default function Link({ href, children, prefetch: _prefetch, replace, scroll: _scroll, onClick, ...rest }: Props) {
  const router = useRouter();
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (replace) router.replace(href);
        else router.push(href);
      }}
    >
      {children}
    </a>
  );
}
