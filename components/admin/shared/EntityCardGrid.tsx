import React from "react";

interface Props {
  children: React.ReactNode;
  minCardWidth?: number;
}

export default function EntityCardGrid({
  children,
  minCardWidth = 180,
}: Props) {
  return (
    <div
      className="grid gap-3.5"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))`,
      }}
    >
      {children}
    </div>
  );
}
