"use client";

interface ColorSwatchProps {
  hex?: string | null;
  patternImage?: string | null;
  size?: number;
  border?: boolean;
  rounded?: "lg" | "full";
  className?: string;
}

export default function ColorSwatch({
  hex,
  patternImage,
  size = 32,
  border = true,
  rounded = "lg",
  className = "",
}: ColorSwatchProps) {
  const roundedClass = rounded === "full" ? "rounded-full" : "rounded-lg";
  const borderClass = border ? "border border-border" : "";

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
