"use client";

import { useEffect, useRef } from "react";

/** Muted looping background video . Stays still for visitors who prefer reduced motion. */
export function HeroVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    void v.play().catch(() => undefined);
  }, []);

  return (
    <video ref={ref} className="absolute inset-0 size-full object-cover" src={src} muted loop playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
  );
}
