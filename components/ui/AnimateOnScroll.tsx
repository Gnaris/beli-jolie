"use client";
import { useEffect, useRef, ReactNode, CSSProperties } from "react";

type Variant = "up" | "down" | "left" | "right" | "zoom" | "blur" | "none";

interface AnimateOnScrollProps {
  children: ReactNode;
  variant?: Variant;
  delay?: number;     // ms
  duration?: number;  // ms
  threshold?: number; // 0-1
  className?: string;
  style?: CSSProperties;
  as?: keyof React.JSX.IntrinsicElements;
}

export default function AnimateOnScroll({
  children,
  variant = "up",
  delay = 0,
  duration = 650,
  threshold = 0.12,
  className = "",
  style,
  as: Tag = "div",
}: AnimateOnScrollProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.classList.add("reveal");
    if (variant !== "none") el.classList.add(`reveal-${variant}`);
    el.style.transitionDelay    = delay    ? `${delay}ms`    : "";
    el.style.transitionDuration = duration ? `${duration}ms` : "";

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-visible");
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [variant, delay, duration, threshold]);

  return (
    // @ts-expect-error dynamic tag
    <Tag ref={ref} className={className} style={style}>
      {children}
    </Tag>
  );
}
