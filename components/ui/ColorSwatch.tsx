"use client";

import { useId } from "react";

/**
 * ColorSwatch — renders a color swatch that can display:
 * 1. A single hex color (solid background)
 * 2. A single pattern image (background-image)
 * 3. A "camembert" (pie chart) mixing hex colors AND/OR pattern images
 *
 * Uses SVG with clipPath for pattern segments in the pie chart.
 */

interface ColorSegment {
  hex?: string | null;
  patternImage?: string | null;
}

interface ColorSwatchProps {
  /** Main color */
  hex?: string | null;
  patternImage?: string | null;
  /** Sub-colors (optional) — combined with main color for pie chart */
  subColors?: ColorSegment[];
  /** Size in pixels (width = height) */
  size?: number;
  /** Border style: true = show border (default), false = no border */
  border?: boolean;
  /** Round shape: "lg" (default) or "full" for circular */
  rounded?: "lg" | "full";
  /** CSS class for the outer container */
  className?: string;
}

export default function ColorSwatch({
  hex,
  patternImage,
  subColors,
  size = 32,
  border = true,
  rounded = "lg",
  className = "",
}: ColorSwatchProps) {
  const reactId = useId();
  const hasSubColors = subColors && subColors.length > 0;
  const roundedClass = rounded === "full" ? "rounded-full" : "rounded-lg";
  const borderClass = border ? "border border-[#E5E5E5]" : "";

  // Single color (no sub-colors)
  if (!hasSubColors) {
    if (patternImage) {
      return (
        <span
          className={`block ${roundedClass} ${borderClass} shrink-0 leading-[0] ${className}`}
          style={{
            width: size,
            height: size,
            backgroundImage: `url(${patternImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      );
    }
    return (
      <span
        className={`block ${roundedClass} ${borderClass} shrink-0 leading-[0] ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: hex || "#9CA3AF",
        }}
      />
    );
  }

  // Multi-color "camembert" (pie chart)
  const allSegments: ColorSegment[] = [
    { hex, patternImage },
    ...subColors,
  ];
  const count = allSegments.length;
  const segmentAngle = 360 / count;
  const hasAnyPattern = allSegments.some((s) => s.patternImage);

  // If no patterns, use simple conic-gradient (faster)
  if (!hasAnyPattern) {
    const stops = allSegments
      .map((s, i) => {
        const color = s.hex || "#9CA3AF";
        return `${color} ${i * segmentAngle}deg ${(i + 1) * segmentAngle}deg`;
      })
      .join(", ");

    return (
      <span
        className={`block ${roundedClass} ${borderClass} shrink-0 leading-[0] ${className}`}
        style={{
          width: size,
          height: size,
          background: `conic-gradient(${stops})`,
        }}
      />
    );
  }

  // SVG pie chart with pattern images + hex segments
  const r = 50; // radius in SVG viewBox (100x100)
  const cx = 50;
  const cy = 50;

  function polarToCartesian(angleDeg: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  function buildArcPath(startAngle: number, endAngle: number) {
    const start = polarToCartesian(startAngle);
    const end = polarToCartesian(endAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
  }

  // useId() is stable across SSR and client — no hydration mismatch
  // Replace colons with dashes for valid SVG IDs
  const uid = `cs${reactId.replace(/:/g, "-")}`;

  return (
    <span
      className={`block ${roundedClass} ${borderClass} shrink-0 leading-[0] overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          {allSegments.map((seg, i) => {
            if (!seg.patternImage) return null;
            return (
              <pattern
                key={`pat-${i}`}
                id={`${uid}-p${i}`}
                patternUnits="objectBoundingBox"
                width="1"
                height="1"
              >
                <image
                  href={seg.patternImage}
                  x="0"
                  y="0"
                  width="100"
                  height="100"
                  preserveAspectRatio="xMidYMid slice"
                />
              </pattern>
            );
          })}
        </defs>
        {allSegments.map((seg, i) => {
          const startAngle = i * segmentAngle;
          const endAngle = (i + 1) * segmentAngle;
          const d = count === 1
            ? `M ${cx} ${cy} m -${r} 0 a ${r} ${r} 0 1 1 ${r * 2} 0 a ${r} ${r} 0 1 1 -${r * 2} 0`
            : buildArcPath(startAngle, endAngle);
          const fill = seg.patternImage
            ? `url(#${uid}-p${i})`
            : seg.hex || "#9CA3AF";

          return <path key={i} d={d} fill={fill} />;
        })}
      </svg>
    </span>
  );
}
