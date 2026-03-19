"use client";

/**
 * Inline decorative shapes scattered within content sections.
 * Use inside a `relative overflow-hidden` parent.
 * variant: "sparse" (few), "dense" (many), "full" (lots)
 */

const SHAPES = {
  diamond: (s: number, o: number) => (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" style={{ opacity: o }}>
      <polygon points="20,2 38,20 20,38 2,20" stroke="#1A1A1A" strokeWidth="0.8" fill="none" />
      <polygon points="20,10 30,20 20,30 10,20" stroke="#1A1A1A" strokeWidth="0.4" fill="none" opacity="0.5" />
    </svg>
  ),
  star4: (s: number, o: number) => (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" style={{ opacity: o }}>
      <path d="M20 4 L23 17 L36 20 L23 23 L20 36 L17 23 L4 20 L17 17 Z" stroke="#1A1A1A" strokeWidth="0.8" fill="none" />
    </svg>
  ),
  hex: (s: number, o: number) => (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" style={{ opacity: o }}>
      <polygon points="20,3 35,12 35,28 20,37 5,28 5,12" stroke="#1A1A1A" strokeWidth="0.8" fill="none" />
    </svg>
  ),
  circle: (s: number, o: number) => (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" style={{ opacity: o }}>
      <circle cx="20" cy="20" r="16" stroke="#1A1A1A" strokeWidth="0.8" fill="none" />
      <circle cx="20" cy="20" r="10" stroke="#1A1A1A" strokeWidth="0.4" fill="none" opacity="0.4" />
    </svg>
  ),
  triangle: (s: number, o: number) => (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" style={{ opacity: o }}>
      <polygon points="20,4 36,34 4,34" stroke="#1A1A1A" strokeWidth="0.8" fill="none" />
    </svg>
  ),
  cross: (s: number, o: number) => (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" style={{ opacity: o }}>
      <line x1="20" y1="4" x2="20" y2="36" stroke="#1A1A1A" strokeWidth="0.8" />
      <line x1="4" y1="20" x2="36" y2="20" stroke="#1A1A1A" strokeWidth="0.8" />
    </svg>
  ),
  gem: (s: number, o: number) => (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" style={{ opacity: o }}>
      <polygon points="20,3 34,14 30,36 10,36 6,14" stroke="#1A1A1A" strokeWidth="0.8" fill="none" />
      <line x1="6" y1="14" x2="34" y2="14" stroke="#1A1A1A" strokeWidth="0.5" opacity="0.5" />
    </svg>
  ),
  ring: (s: number, o: number) => (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" style={{ opacity: o }}>
      <circle cx="20" cy="22" r="14" stroke="#1A1A1A" strokeWidth="0.8" fill="none" />
      <polygon points="20,4 24,12 16,12" stroke="#1A1A1A" strokeWidth="0.6" fill="none" />
    </svg>
  ),
  dots: (s: number, o: number) => (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" style={{ opacity: o }}>
      <circle cx="10" cy="20" r="2.5" fill="#1A1A1A" />
      <circle cx="20" cy="20" r="2.5" fill="#1A1A1A" />
      <circle cx="30" cy="20" r="2.5" fill="#1A1A1A" />
    </svg>
  ),
  sparkle: (s: number, o: number) => (
    <svg width={s} height={s} viewBox="0 0 40 40" fill="none" style={{ opacity: o }}>
      <path d="M20 6 L22 18 L34 20 L22 22 L20 34 L18 22 L6 20 L18 18 Z" fill="#1A1A1A" />
    </svg>
  ),
};

type ShapeKey = keyof typeof SHAPES;
const SHAPE_KEYS: ShapeKey[] = Object.keys(SHAPES) as ShapeKey[];

type Decoration = {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  rotate: number;
  shape: ShapeKey;
  anim: string;
  delay: string;
};

// Pre-computed decoration sets per variant using a seeded sequence
function generateDecorations(variant: "sparse" | "dense" | "full", seed: number): Decoration[] {
  const counts = { sparse: 6, dense: 10, full: 16 };
  const count = counts[variant];
  const items: Decoration[] = [];
  const anims = ["animate-geo-1", "animate-geo-2", "animate-geo-3", "animate-geo-spin", "animate-geo-pulse"];

  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random using seed
    const s = ((seed + i * 7 + 13) * 2654435761) >>> 0;
    const r = (n: number) => ((s * (i * 3 + n + 1) * 16807) >>> 0) % 1000 / 1000;

    items.push({
      id: i,
      x: r(0) * 94 + 2,
      y: r(1) * 90 + 4,
      size: 20 + r(2) * 32,
      opacity: 0.08 + r(3) * 0.1,
      rotate: r(4) * 360 - 180,
      shape: SHAPE_KEYS[Math.floor(r(5) * SHAPE_KEYS.length)],
      anim: anims[Math.floor(r(6) * anims.length)],
      delay: `${(r(7) * 12).toFixed(1)}s`,
    });
  }
  return items;
}

// Pre-compute a few variants to avoid computing on each render
const SETS: Record<string, Decoration[]> = {
  "sparse-1": generateDecorations("sparse", 1),
  "sparse-2": generateDecorations("sparse", 2),
  "sparse-3": generateDecorations("sparse", 3),
  "dense-1": generateDecorations("dense", 10),
  "dense-2": generateDecorations("dense", 20),
  "dense-3": generateDecorations("dense", 30),
  "full-1": generateDecorations("full", 100),
  "full-2": generateDecorations("full", 200),
  "full-3": generateDecorations("full", 300),
};

export default function ScatteredDecorations({
  variant = "dense",
  seed = 1,
}: {
  variant?: "sparse" | "dense" | "full";
  seed?: number;
}) {
  const key = `${variant}-${seed}`;
  const decorations = SETS[key] ?? generateDecorations(variant, seed);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {decorations.map((d) => {
        const ShapeFn = SHAPES[d.shape];
        return (
          <div
            key={d.id}
            className={d.anim}
            style={{
              position: "absolute",
              left: `${d.x}%`,
              top: `${d.y}%`,
              transform: `rotate(${d.rotate}deg)`,
              animationDelay: d.delay,
            }}
          >
            {ShapeFn(d.size, d.opacity)}
          </div>
        );
      })}
    </div>
  );
}
