"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-runs the page's Server Components on an interval; no browser DB client. */
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
