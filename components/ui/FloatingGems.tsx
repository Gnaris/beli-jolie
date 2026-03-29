"use client";

const GEMS = [
  // Diamond shapes (losanges)
  { id: 1, x: 8,  y: 12, size: 28, opacity: 0.07, delay: "0s",   duration: "6s",  rotate: 15,  shape: "diamond" },
  { id: 2, x: 88, y: 8,  size: 20, opacity: 0.06, delay: "1.2s", duration: "7s",  rotate: -20, shape: "diamond" },
  { id: 3, x: 15, y: 78, size: 24, opacity: 0.05, delay: "2.1s", duration: "5.5s",rotate: 35,  shape: "diamond" },
  { id: 4, x: 82, y: 70, size: 32, opacity: 0.07, delay: "0.8s", duration: "8s",  rotate: -10, shape: "diamond" },
  { id: 5, x: 50, y: 5,  size: 18, opacity: 0.05, delay: "3s",   duration: "6.5s",rotate: 45,  shape: "diamond" },
  // Stars
  { id: 6, x: 25, y: 40, size: 16, opacity: 0.08, delay: "1.5s", duration: "4.5s",rotate: 0,   shape: "star" },
  { id: 7, x: 72, y: 35, size: 14, opacity: 0.07, delay: "2.5s", duration: "5s",  rotate: 20,  shape: "star" },
  { id: 8, x: 5,  y: 55, size: 12, opacity: 0.06, delay: "0.5s", duration: "7.5s",rotate: -15, shape: "star" },
  { id: 9, x: 92, y: 50, size: 18, opacity: 0.07, delay: "1.8s", duration: "6s",  rotate: 30,  shape: "star" },
  // Circles (perles)
  { id: 10, x: 40, y: 88, size: 12, opacity: 0.06, delay: "2.8s", duration: "9s", rotate: 0, shape: "circle" },
  { id: 11, x: 60, y: 85, size: 8,  opacity: 0.05, delay: "0.3s", duration: "8s", rotate: 0, shape: "circle" },
  { id: 12, x: 30, y: 15, size: 10, opacity: 0.07, delay: "1s",   duration: "7s", rotate: 0, shape: "circle" },
  // Ring shapes (hexagons as rings)
  { id: 13, x: 65, y: 20, size: 26, opacity: 0.06, delay: "3.5s", duration: "7.5s", rotate: 10, shape: "ring" },
  { id: 14, x: 10, y: 90, size: 22, opacity: 0.05, delay: "2.2s", duration: "8.5s", rotate: -25, shape: "ring" },
  { id: 15, x: 78, y: 90, size: 18, opacity: 0.06, delay: "1.1s", duration: "6.8s", rotate: 15, shape: "ring" },
];

function DiamondSVG({ size, color }: { size: number; color: string }) {
  const h = size, w = size * 0.7;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <polygon
        points={`${w/2},0 ${w},${h*0.35} ${w/2},${h} 0,${h*0.35}`}
        fill={color}
        stroke={color}
        strokeWidth="1"
      />
      <line x1={w/2} y1={0} x2={0} y2={h*0.35} stroke="white" strokeWidth="0.5" opacity="0.4" />
      <line x1={w/2} y1={0} x2={w} y2={h*0.35} stroke="white" strokeWidth="0.5" opacity="0.4" />
      <line x1={0} y1={h*0.35} x2={w/2} y2={h} stroke="white" strokeWidth="0.5" opacity="0.2" />
      <line x1={w} y1={h*0.35} x2={w/2} y2={h} stroke="white" strokeWidth="0.5" opacity="0.2" />
    </svg>
  );
}

// Pre-computed star points for each size used in GEMS to avoid hydration mismatches
const STAR_POINTS: Record<number, string> = {};
function getStarPoints(size: number): string {
  if (STAR_POINTS[size]) return STAR_POINTS[size];
  const r = size / 2;
  const pts = Array.from({ length: 5 }, (_, i) => {
    const outerAngle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const innerAngle = ((i * 4 + 2) * Math.PI) / 5 - Math.PI / 2;
    return [
      `${(r + Math.cos(outerAngle) * r).toFixed(2)},${(r + Math.sin(outerAngle) * r).toFixed(2)}`,
      `${(r + Math.cos(innerAngle) * r * 0.42).toFixed(2)},${(r + Math.sin(innerAngle) * r * 0.42).toFixed(2)}`,
    ];
  }).flat().join(" ");
  STAR_POINTS[size] = pts;
  return pts;
}
// Pre-compute for all sizes used in GEMS
[16, 14, 12, 18].forEach(getStarPoints);

function StarSVG({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <polygon points={getStarPoints(size)} fill={color} />
    </svg>
  );
}

function RingSVG({ size, color }: { size: number; color: string }) {
  const r = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={r} cy={r} r={r - 2} fill="none" stroke={color} strokeWidth="3" />
      <circle cx={r} cy={r} r={r - 5} fill="none" stroke={color} strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

function CircleSVG({ size, color }: { size: number; color: string }) {
  const r = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={r} cy={r} r={r - 1} fill={color} />
    </svg>
  );
}

export default function FloatingGems() {
  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none select-none"
      aria-hidden="true"
    >
      {GEMS.map((gem) => {
        const color = "#1A56DB";
        return (
          <div
            key={gem.id}
            className="absolute"
            style={{
              left:       `${gem.x}%`,
              top:        `${gem.y}%`,
              opacity:    gem.opacity,
              transform:  `rotate(${gem.rotate}deg)`,
              animation:  `gem-float ${gem.duration} ease-in-out infinite`,
              animationDelay: gem.delay,
            }}
          >
            {gem.shape === "diamond" && <DiamondSVG size={gem.size} color={color} />}
            {gem.shape === "star"    && <StarSVG    size={gem.size} color={color} />}
            {gem.shape === "ring"    && <RingSVG    size={gem.size} color={color} />}
            {gem.shape === "circle"  && <CircleSVG  size={gem.size} color={color} />}
          </div>
        );
      })}

      {/* Gradient glow spots */}
      <div
        className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-[0.04]"
        style={{ background: "radial-gradient(circle, #1A56DB 0%, transparent 70%)" }}
      />
      <div
        className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full opacity-[0.04]"
        style={{ background: "radial-gradient(circle, #1A56DB 0%, transparent 70%)" }}
      />
    </div>
  );
}
