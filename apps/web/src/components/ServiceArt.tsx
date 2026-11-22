/**
 * Default card pictures (drawn, no files to host). Real photos replace these when the clinic supplies them.
 * The shapes are fixed strings written here, never user input.
 */
const ART: Record<string, string> = {
  steth: '<path d="M130 46C122 96 160 98 160 124M190 46C198 96 160 98 160 124"/><circle cx="130" cy="42" r="6"/><circle cx="190" cy="42" r="6"/><circle cx="160" cy="138" r="15"/><circle cx="160" cy="138" r="5" fill="#fff"/>',
  phone: '<rect x="124" y="30" width="72" height="120" rx="14"/><path d="M146 44h28M152 136h16"/><path d="M212 66q20 22 0 46M226 54q30 34 0 70"/>',
  urgent: '<path d="M150 40h20v36h36v20h-36v36h-20V96h-36V76h36z" fill="#fff"/>',
  drop: '<path d="M160 36C160 36 118 88 118 114a42 42 0 0 0 84 0C202 88 160 36 160 36z" fill="#fff"/>',
  cert: '<rect x="118" y="30" width="84" height="116" rx="8"/><path d="M134 62h52M134 80h52M134 98h30"/><circle cx="178" cy="124" r="14"/><path d="M171 124l5 5 9-10"/>',
  heart: '<path d="M160 142C98 102 108 52 140 52c12 0 20 10 20 20 0-10 8-20 20-20 32 0 42 50-20 90z" fill="#fff"/><path d="M92 98h36l10-22 14 46 12-30h44" stroke="#9b1c2b"/>',
  shield: '<path d="M160 34l50 14v40c0 32-22 52-50 64-28-12-50-32-50-64V48z" fill="#fff"/><path d="M138 92l16 16 30-34" stroke="#17335b"/>',
  syringe: '<g transform="rotate(-32 160 90)"><rect x="120" y="74" width="76" height="32" rx="6"/><path d="M196 90h40M120 90h-24M96 76v28M136 74v10M152 74v10M168 74v10"/></g>',
  women: '<circle cx="160" cy="70" r="30"/><path d="M160 100v52M138 128h44"/>',
  men: '<circle cx="148" cy="106" r="30"/><path d="M170 84l38-38M184 46h24v24"/>',
  child: '<circle cx="160" cy="92" r="36"/><circle cx="128" cy="62" r="13"/><circle cx="192" cy="62" r="13"/><circle cx="148" cy="86" r="3" fill="#fff"/><circle cx="172" cy="86" r="3" fill="#fff"/><path d="M146 104q14 12 28 0"/>',
  scalpel: '<path d="M104 146L206 56"/><path d="M206 56l32-16-12 36z" fill="#fff"/><path d="M96 152l14-12"/>',
  pills: '<g transform="rotate(-30 150 84)"><rect x="104" y="62" width="92" height="44" rx="22"/><path d="M150 62v44"/></g><circle cx="218" cy="128" r="20"/><path d="M204 128h28"/>',
  clip: '<rect x="120" y="38" width="80" height="108" rx="8"/><rect x="142" y="30" width="36" height="16" rx="5" fill="#fff"/><path d="M136 78l6 6 10-12M164 78h22M136 106l6 6 10-12M164 106h22"/>',
  pulse: '<path d="M64 96h58l16-44 28 88 20-60h72"/>',
};

const TONES: [string, string, string][] = [["#17335b", "#2f5b99", "#0f2447"], ["#9b1c2b", "#c4414f", "#6e1220"], ["#566075", "#8d96a8", "#3b4457"]];
const TONE: Record<string, number> = { steth: 0, phone: 0, urgent: 1, drop: 1, cert: 2, heart: 1, shield: 0, syringe: 2, women: 1, men: 0, child: 2, scalpel: 2, pills: 1, clip: 0, pulse: 1 };

/** Pick a picture from the service's slug or category. */
export function artKeyFor(slug: string, category = ""): string {
  const s = `${slug} ${category}`.toLowerCase();
  if (s.includes("phone")) return "phone";
  if (s.includes("urgent") || s.includes("same-day")) return "urgent";
  if (s.includes("blood")) return "drop";
  if (s.includes("sick") || s.includes("certificate") || s.includes("forms")) return "cert";
  if (s.includes("child")) return "child";
  if (s.includes("vaccin")) return "syringe";
  if (s.includes("procedure") || s.includes("surgery")) return "scalpel";
  if (s.includes("chronic") || s.includes("ongoing")) return "pulse";
  if (s.includes("check") || s.includes("screen") || s.includes("preventive")) return "heart";
  return "steth";
}

export function ServiceArt({ name, className = "" }: { name: string; className?: string }) {
  const k = ART[name] ? name : "steth";
  const [a, b, c] = TONES[TONE[k] ?? 0]!;
  const dots = Array.from({ length: 7 }, (_, r) => Array.from({ length: 14 }, (_, q) => `<circle cx="${14 + q * 24 + (r % 2) * 12}" cy="${14 + r * 14}" r="1.4"/>`).join("")).join("");
  const id = `a-${k}`;
  const inner =
    `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>` +
    `<radialGradient id="${id}r" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<filter id="${id}s" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity=".35"/></filter></defs>` +
    `<rect width="320" height="180" fill="url(#${id}g)"/><g fill="#fff" opacity=".1">${dots}</g>` +
    `<rect x="212" y="14" width="86" height="64" rx="8" fill="#fff" opacity=".1"/><path d="M255 14v64M212 46h86" stroke="#fff" stroke-opacity=".18" stroke-width="3"/>` +
    `<path d="M0 132C70 112 130 150 200 132S290 112 320 124V180H0z" fill="${c}" opacity=".55"/><path d="M0 150C80 134 140 166 220 150S300 138 320 146V180H0z" fill="${c}" opacity=".8"/>` +
    `<ellipse cx="160" cy="165" rx="58" ry="7" fill="#000" opacity=".22"/>` +
    `<circle cx="160" cy="92" r="82" fill="url(#${id}r)"/><circle cx="160" cy="92" r="66" fill="#fff" opacity=".12"/><circle cx="160" cy="92" r="66" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>` +
    `<g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}s)">${ART[k]}</g>`;
  return (
    <svg viewBox="0 0 320 180" className={className} role="img" aria-label="" aria-hidden="true" preserveAspectRatio="xMidYMid slice" dangerouslySetInnerHTML={{ __html: inner }} />
  );
}

/** Real photos (free Unsplash licence, see docs/PHOTO-CREDITS.md). Keys without a photo fall back to the drawing. */
const PHOTOS: Record<string, string> = {
  steth: "stethoscope-blue", phone: "phone-consult", urgent: "urgent-bp", drop: "blood-tubes",
  heart: "stethoscope-burgundy", child: "child-teddy", syringe: "syringe", pills: "pills",
};

export function ServicePicture({ slug, category, className = "" }: { slug: string; category?: string; className?: string }) {
  const key = artKeyFor(slug, category);
  const photo = PHOTOS[key];
  if (!photo) return <ServiceArt name={key} className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/photos/${photo}.jpg`} alt="" width={900} height={600} loading="lazy" className={`object-cover ${className}`} />;
}
