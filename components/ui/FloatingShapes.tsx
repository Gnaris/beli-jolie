"use client";

/**
 * Elegant floating decorative SVG shapes behind page content.
 * Purely decorative — pointer-events: none.
 */

/* ── SVG shape components ── */

function GemStoneSVG({ size, opacity }: { size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity }}>
      <polygon points="32,4 56,22 48,58 16,58 8,22" stroke="#1A1A1A" strokeWidth="1.2" fill="none" />
      <line x1="32" y1="4" x2="16" y2="58" stroke="#1A1A1A" strokeWidth="0.6" opacity="0.5" />
      <line x1="32" y1="4" x2="48" y2="58" stroke="#1A1A1A" strokeWidth="0.6" opacity="0.5" />
      <line x1="8" y1="22" x2="48" y2="58" stroke="#1A1A1A" strokeWidth="0.5" opacity="0.4" />
      <line x1="56" y1="22" x2="16" y2="58" stroke="#1A1A1A" strokeWidth="0.5" opacity="0.4" />
      <line x1="8" y1="22" x2="56" y2="22" stroke="#1A1A1A" strokeWidth="0.8" opacity="0.6" />
    </svg>
  );
}

function RingSVG({ size, opacity }: { size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity }}>
      <ellipse cx="32" cy="38" rx="20" ry="18" stroke="#1A1A1A" strokeWidth="1.2" fill="none" />
      <ellipse cx="32" cy="38" rx="14" ry="12" stroke="#1A1A1A" strokeWidth="0.6" fill="none" opacity="0.5" />
      <polygon points="32,14 38,22 26,22" stroke="#1A1A1A" strokeWidth="1" fill="none" />
      <line x1="32" y1="22" x2="32" y2="20" stroke="#1A1A1A" strokeWidth="0.5" opacity="0.5" />
    </svg>
  );
}

function StarSVG({ size, opacity }: { size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity }}>
      <path
        d="M32 6 L36 26 L56 32 L36 38 L32 58 L28 38 L8 32 L28 26 Z"
        stroke="#1A1A1A" strokeWidth="1" fill="none"
      />
      <circle cx="32" cy="32" r="3" stroke="#1A1A1A" strokeWidth="0.6" fill="none" opacity="0.6" />
    </svg>
  );
}

function ChainLinkSVG({ size, opacity }: { size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity }}>
      <ellipse cx="24" cy="32" rx="14" ry="10" stroke="#1A1A1A" strokeWidth="1" fill="none" transform="rotate(-20,24,32)" />
      <ellipse cx="40" cy="32" rx="14" ry="10" stroke="#1A1A1A" strokeWidth="1" fill="none" transform="rotate(20,40,32)" />
    </svg>
  );
}

function PearlSVG({ size, opacity }: { size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity }}>
      <circle cx="32" cy="32" r="22" stroke="#1A1A1A" strokeWidth="1" fill="none" />
      <circle cx="32" cy="32" r="18" stroke="#1A1A1A" strokeWidth="0.5" fill="none" opacity="0.4" />
      <ellipse cx="24" cy="24" rx="6" ry="4" stroke="#1A1A1A" strokeWidth="0.5" fill="none" opacity="0.5" transform="rotate(-30,24,24)" />
    </svg>
  );
}

function PendantSVG({ size, opacity }: { size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity }}>
      <path
        d="M32 8 C32 8, 50 28, 50 40 C50 50, 42 56, 32 56 C22 56, 14 50, 14 40 C14 28, 32 8, 32 8 Z"
        stroke="#1A1A1A" strokeWidth="1" fill="none"
      />
      <line x1="32" y1="2" x2="32" y2="8" stroke="#1A1A1A" strokeWidth="0.7" opacity="0.6" />
      <circle cx="32" cy="38" r="6" stroke="#1A1A1A" strokeWidth="0.5" fill="none" opacity="0.5" />
    </svg>
  );
}

function HexagonSVG({ size, opacity }: { size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity }}>
      <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" stroke="#1A1A1A" strokeWidth="1" fill="none" />
      <polygon points="32,14 46,22 46,40 32,48 18,40 18,22" stroke="#1A1A1A" strokeWidth="0.5" fill="none" opacity="0.4" />
    </svg>
  );
}

function TriangleSVG({ size, opacity }: { size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity }}>
      <polygon points="32,6 58,56 6,56" stroke="#1A1A1A" strokeWidth="1" fill="none" />
      <line x1="32" y1="6" x2="32" y2="56" stroke="#1A1A1A" strokeWidth="0.5" opacity="0.4" />
      <line x1="6" y1="56" x2="45" y2="31" stroke="#1A1A1A" strokeWidth="0.4" opacity="0.3" />
    </svg>
  );
}

function DiamondSVG({ size, opacity }: { size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity }}>
      <polygon points="32,4 60,32 32,60 4,32" stroke="#1A1A1A" strokeWidth="1" fill="none" />
      <polygon points="32,14 50,32 32,50 14,32" stroke="#1A1A1A" strokeWidth="0.5" fill="none" opacity="0.4" />
      <line x1="4" y1="32" x2="60" y2="32" stroke="#1A1A1A" strokeWidth="0.4" opacity="0.3" />
    </svg>
  );
}

function CrossSVG({ size, opacity }: { size: number; opacity: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ opacity }}>
      <line x1="32" y1="6" x2="32" y2="58" stroke="#1A1A1A" strokeWidth="1.2" />
      <line x1="6" y1="32" x2="58" y2="32" stroke="#1A1A1A" strokeWidth="1.2" />
      <circle cx="32" cy="32" r="6" stroke="#1A1A1A" strokeWidth="0.6" fill="none" opacity="0.5" />
    </svg>
  );
}

/* ── Shape configuration ── */
type ShapeType = "gem" | "ring" | "star" | "chain" | "pearl" | "pendant" | "hexagon" | "triangle" | "diamond" | "cross";

const SHAPES: {
  id: number; x: number; y: number; size: number; opacity: number;
  anim: string; delay: string; rotate: number; shape: ShapeType;
}[] = [
  // Row 1 — top area (y: 2-15)
  { id: 1,  x: 3,   y: 5,   size: 72, opacity: 0.15, anim: "animate-geo-1",    delay: "0s",    rotate: 15,  shape: "gem" },
  { id: 2,  x: 22,  y: 3,   size: 48, opacity: 0.12, anim: "animate-geo-spin",  delay: "3s",    rotate: 0,   shape: "hexagon" },
  { id: 3,  x: 45,  y: 8,   size: 56, opacity: 0.13, anim: "animate-geo-2",    delay: "1s",    rotate: 0,   shape: "pearl" },
  { id: 4,  x: 60,  y: 3,   size: 56, opacity: 0.12, anim: "animate-geo-3",    delay: "1.5s",  rotate: 20,  shape: "chain" },
  { id: 5,  x: 87,  y: 10,  size: 64, opacity: 0.14, anim: "animate-geo-2",    delay: "2s",    rotate: -10, shape: "star" },

  // Row 2 — upper-mid (y: 18-35)
  { id: 6,  x: 8,   y: 22,  size: 44, opacity: 0.11, anim: "animate-geo-pulse", delay: "0.5s",  rotate: 45,  shape: "diamond" },
  { id: 7,  x: 30,  y: 20,  size: 52, opacity: 0.13, anim: "animate-geo-1",    delay: "4s",    rotate: -5,  shape: "gem" },
  { id: 8,  x: 52,  y: 25,  size: 40, opacity: 0.10, anim: "animate-geo-spin",  delay: "6s",    rotate: 15,  shape: "cross" },
  { id: 9,  x: 70,  y: 18,  size: 50, opacity: 0.12, anim: "animate-geo-3",    delay: "2.5s",  rotate: -20, shape: "triangle" },
  { id: 10, x: 92,  y: 28,  size: 58, opacity: 0.11, anim: "animate-geo-pulse", delay: "5s",    rotate: 10,  shape: "pendant" },

  // Row 3 — middle (y: 38-55)
  { id: 11, x: 2,   y: 45,  size: 60, opacity: 0.13, anim: "animate-geo-3",    delay: "4s",    rotate: 8,   shape: "ring" },
  { id: 12, x: 18,  y: 40,  size: 42, opacity: 0.10, anim: "animate-geo-2",    delay: "7s",    rotate: -12, shape: "hexagon" },
  { id: 13, x: 38,  y: 48,  size: 66, opacity: 0.14, anim: "animate-geo-1",    delay: "1.8s",  rotate: 22,  shape: "star" },
  { id: 14, x: 58,  y: 42,  size: 46, opacity: 0.11, anim: "animate-geo-spin",  delay: "3.5s",  rotate: 0,   shape: "pearl" },
  { id: 15, x: 80,  y: 50,  size: 54, opacity: 0.12, anim: "animate-geo-3",    delay: "8s",    rotate: -8,  shape: "diamond" },
  { id: 16, x: 95,  y: 40,  size: 64, opacity: 0.13, anim: "animate-geo-1",    delay: "3s",    rotate: 12,  shape: "chain" },

  // Row 4 — lower-mid (y: 58-75)
  { id: 17, x: 5,   y: 65,  size: 50, opacity: 0.12, anim: "animate-geo-pulse", delay: "2s",    rotate: 30,  shape: "triangle" },
  { id: 18, x: 25,  y: 60,  size: 62, opacity: 0.14, anim: "animate-geo-2",    delay: "5.5s",  rotate: -18, shape: "pendant" },
  { id: 19, x: 42,  y: 68,  size: 38, opacity: 0.10, anim: "animate-geo-spin",  delay: "0.8s",  rotate: 40,  shape: "cross" },
  { id: 20, x: 62,  y: 62,  size: 70, opacity: 0.15, anim: "animate-geo-1",    delay: "6.5s",  rotate: -5,  shape: "gem" },
  { id: 21, x: 82,  y: 70,  size: 48, opacity: 0.11, anim: "animate-geo-3",    delay: "4.2s",  rotate: 15,  shape: "ring" },

  // Row 5 — bottom area (y: 78-95)
  { id: 22, x: 10,  y: 85,  size: 56, opacity: 0.13, anim: "animate-geo-1",    delay: "7.5s",  rotate: -25, shape: "hexagon" },
  { id: 23, x: 28,  y: 80,  size: 44, opacity: 0.11, anim: "animate-geo-pulse", delay: "1.2s",  rotate: 18,  shape: "star" },
  { id: 24, x: 48,  y: 90,  size: 52, opacity: 0.12, anim: "animate-geo-2",    delay: "9s",    rotate: -30, shape: "chain" },
  { id: 25, x: 65,  y: 82,  size: 60, opacity: 0.14, anim: "animate-geo-3",    delay: "2.8s",  rotate: 5,   shape: "diamond" },
  { id: 26, x: 85,  y: 88,  size: 46, opacity: 0.11, anim: "animate-geo-spin",  delay: "5.2s",  rotate: -15, shape: "pendant" },
  { id: 27, x: 50,  y: 55,  size: 36, opacity: 0.09, anim: "animate-geo-1",    delay: "10s",   rotate: 35,  shape: "triangle" },
  { id: 28, x: 75,  y: 38,  size: 40, opacity: 0.10, anim: "animate-geo-pulse", delay: "4.8s",  rotate: -22, shape: "pearl" },
  { id: 29, x: 15,  y: 55,  size: 44, opacity: 0.11, anim: "animate-geo-2",    delay: "6.2s",  rotate: 12,  shape: "cross" },
  { id: 30, x: 90,  y: 60,  size: 50, opacity: 0.12, anim: "animate-geo-3",    delay: "8.5s",  rotate: -35, shape: "gem" },
];

const shapeComponents: Record<ShapeType, React.FC<{ size: number; opacity: number }>> = {
  gem:      GemStoneSVG,
  ring:     RingSVG,
  star:     StarSVG,
  chain:    ChainLinkSVG,
  pearl:    PearlSVG,
  pendant:  PendantSVG,
  hexagon:  HexagonSVG,
  triangle: TriangleSVG,
  diamond:  DiamondSVG,
  cross:    CrossSVG,
};

export default function FloatingShapes() {
  return (
    <div
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
      aria-hidden="true"
    >
      {SHAPES.map((s) => {
        const Shape = shapeComponents[s.shape];
        return (
          <div
            key={s.id}
            className={s.anim}
            style={{
              position: "absolute",
              left: `${s.x}%`,
              top: `${s.y}%`,
              transform: `rotate(${s.rotate}deg)`,
              animationDelay: s.delay,
            }}
          >
            <Shape size={s.size} opacity={s.opacity} />
          </div>
        );
      })}

      {/* Subtle radial glow spots */}
      <div
        className="absolute top-[10%] left-[5%] w-64 h-64 rounded-full animate-geo-2"
        style={{
          background: "radial-gradient(circle, rgba(26,26,26,0.04) 0%, transparent 70%)",
          animationDelay: "0s",
        }}
      />
      <div
        className="absolute top-[45%] right-[15%] w-56 h-56 rounded-full animate-geo-1"
        style={{
          background: "radial-gradient(circle, rgba(26,26,26,0.035) 0%, transparent 70%)",
          animationDelay: "5s",
        }}
      />
      <div
        className="absolute bottom-[15%] right-[8%] w-48 h-48 rounded-full animate-geo-3"
        style={{
          background: "radial-gradient(circle, rgba(26,26,26,0.03) 0%, transparent 70%)",
          animationDelay: "3s",
        }}
      />
      <div
        className="absolute bottom-[30%] left-[20%] w-72 h-72 rounded-full animate-geo-pulse"
        style={{
          background: "radial-gradient(circle, rgba(26,26,26,0.03) 0%, transparent 70%)",
          animationDelay: "7s",
        }}
      />
    </div>
  );
}
