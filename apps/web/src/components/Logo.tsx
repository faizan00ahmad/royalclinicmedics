/** Royal Medics shield (navy over crimson, silver edge, ECG line) with the serif wordmark. */
export function Logo({ light = false, size = 44 }: { light?: boolean; size?: number }) {
  return (
    <span className="inline-flex items-center gap-3" aria-label="Royal Medics">
      <svg width={size} height={Math.round(size * 1.12)} viewBox="0 0 50 56" aria-hidden="true">
        <defs>
          <clipPath id="rm-clip"><path d="M25 3 45 9v20c0 13-9 21-20 25C14 50 5 42 5 29V9z" /></clipPath>
        </defs>
        <path d="M25 1 48 8v21c0 15-10 23-23 27C12 52 2 44 2 29V8z" fill="#a9abb0" />
        <g clipPath="url(#rm-clip)">
          <rect width="50" height="56" fill="#17335b" />
          <rect y="30" width="50" height="30" fill="#9b1c2b" />
        </g>
        <path d="M8 24h9l3-7 5 14 4-10 2 3h11" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="25" cy="41" r="3" fill="none" stroke="#fff" strokeWidth="1.6" />
      </svg>
      <span className={`font-serif leading-none ${light ? "text-white" : "text-brand-700"}`}>
        <span className="block text-xl font-bold tracking-[0.12em]">ROYAL</span>
        <span className="mt-1 block text-[0.62rem] font-semibold tracking-[0.5em]">MEDICS</span>
      </span>
    </span>
  );
}
