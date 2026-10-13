// QA harness: next/dynamic as React.lazy (no SSR here anyway).
import { createElement, lazy, Suspense } from "react";

export default function dynamic<P extends object>(loader: () => Promise<unknown>) {
  const L = lazy(() => loader().then((m) => ({ default: ((m as { default?: unknown }).default ?? m) as React.ComponentType<P> })));
  return function Dynamic(props: P) {
    return createElement(Suspense, { fallback: null }, createElement(L, props));
  };
}
