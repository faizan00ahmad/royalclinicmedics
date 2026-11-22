"use client";

import { useEffect, useRef, useState } from "react";

/** Muted looping background video with a Pause button. Stays still for visitors who prefer reduced motion. */
export function HeroVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    void v.play().catch(() => undefined);
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined); else v.pause();
  };

  return (
    <>
      <video ref={ref} className="absolute inset-0 size-full object-cover" src={src} muted loop playsInline preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} aria-hidden="true" tabIndex={-1} />
      <button type="button" onClick={toggle} aria-label={playing ? "Pause background video" : "Play background video"}
        className="absolute bottom-4 right-4 z-10 inline-flex min-h-11 items-center rounded-full bg-black/40 px-4 text-sm font-semibold text-white backdrop-blur hover:bg-black/60">
        {playing ? "Pause" : "Play"}
      </button>
    </>
  );
}
