/* eslint-disable @typescript-eslint/no-explicit-any */
// QA harness, imported first: perf counters, and with ?count=1 a stand-in React devtools hook that counts renders
// per component name on every commit (a fiber rendered when it's new or its props/state object changed).
const W = window as any;
W.__perf = { commits: [], renders: {} };
if (new URLSearchParams(location.search).get("count")) {
  const seen = new WeakMap<object, { p: unknown; s: unknown }>();
  W.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    onCommitFiberRoot(_id: number, root: any) {
      const renders = W.__perf.renders;
      const walk = (f: any) => {
        for (; f; f = f.sibling) {
          const t = f.type;
          if (typeof t === "function" || (t && typeof t === "object" && f.tag !== 5)) {
            const key = f.alternate && seen.has(f.alternate) ? f.alternate : f;
            const prev = seen.get(key);
            if (!prev || prev.p !== f.memoizedProps || prev.s !== f.memoizedState) {
              const name = (typeof t === "function" ? t.displayName || t.name : t.displayName || t.render?.name || t.type?.name) || "?";
              renders[name] = (renders[name] ?? 0) + 1;
              seen.set(key, { p: f.memoizedProps, s: f.memoizedState });
            }
          }
          if (f.child) walk(f.child);
        }
      };
      walk(root.current.child);
    },
  };
}
export {};
