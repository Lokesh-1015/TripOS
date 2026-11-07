import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * The phone's floating "+" opens a tab with `?new=1`. The tab starts adding something, then drops the
 * marker, so it works whether the tab was already open or is just opening.
 */
export function useQuickAdd(handler: () => void) {
  const [params, setParams] = useSearchParams();
  const latest = useRef(handler);
  latest.current = handler;
  const asked = params.get("new") === "1";
  useEffect(() => {
    if (!asked) return;
    latest.current();
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  }, [asked, params, setParams]);
}
