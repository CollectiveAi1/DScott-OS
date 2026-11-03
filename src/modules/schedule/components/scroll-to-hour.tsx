"use client";

import { useEffect, useRef } from "react";

/**
 * A 24-hour grid opens at midnight, which is never where the day is. This scrolls its own
 * scroll container to the given hour once, on mount. Pure CSS cannot set a container's initial
 * scroll position, and hiding the small hours would hide conflicts.
 */
export function ScrollToHour({ hour, rowHeightRem = 1.25 }: { hour: number; rowHeightRem?: number }) {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = marker.current?.closest<HTMLElement>("[data-hours]");
    if (!container) return;
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    // Two rows per hour.
    container.scrollTop = hour * 2 * rowHeightRem * rem;
  }, [hour, rowHeightRem]);

  return <span ref={marker} aria-hidden="true" className="sr-only" />;
}
