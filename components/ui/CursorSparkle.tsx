"use client";
import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
  shape: "star" | "diamond" | "circle";
}

const COLORS = ["#FFD700", "#FFF8DC", "#E8C76B", "#F5E6A3", "#FFFFFF", "#D4AF37"];

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const outerAngle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const innerAngle = ((i * 4 + 2) * Math.PI) / 5 - Math.PI / 2;
    if (i === 0) ctx.moveTo(Math.cos(outerAngle) * r, Math.sin(outerAngle) * r);
    else ctx.lineTo(Math.cos(outerAngle) * r, Math.sin(outerAngle) * r);
    ctx.lineTo(Math.cos(innerAngle) * r * 0.45, Math.sin(innerAngle) * r * 0.45);
  }
  ctx.closePath();
  ctx.restore();
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.6, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r * 0.6, 0);
  ctx.closePath();
  ctx.restore();
}

export default function CursorSparkle() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const mouseRef  = useRef({ x: -999, y: -999 });
  const rafRef    = useRef<number>(0);
  const lastSpawn = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      if (!canvas) return;
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    function spawnParticles(x: number, y: number) {
      const count = Math.floor(Math.random() * 3) + 2;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 1.8 + 0.6;
        const shapes: Particle["shape"][] = ["star", "diamond", "circle"];
        particles.current.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.8,
          life: 0,
          maxLife: Math.floor(Math.random() * 30) + 25,
          size: Math.random() * 5 + 3,
          hue: 0,
          shape: shapes[Math.floor(Math.random() * shapes.length)],
        });
      }
    }

    function onMouseMove(e: MouseEvent) {
      mouseRef.current = { x: e.clientX, y: e.clientY };
      const now = Date.now();
      if (now - lastSpawn.current > 40) {
        spawnParticles(e.clientX, e.clientY);
        lastSpawn.current = now;
      }
    }
    window.addEventListener("mousemove", onMouseMove);

    function loop() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.current = particles.current.filter((p) => p.life < p.maxLife);

      for (const p of particles.current) {
        const t       = p.life / p.maxLife;
        const opacity = Math.sin(t * Math.PI);
        const radius  = p.size * (1 - t * 0.5);
        const color   = COLORS[Math.floor(t * COLORS.length) % COLORS.length];

        ctx.globalAlpha = opacity * 0.85;
        ctx.fillStyle   = color;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 6;

        ctx.beginPath();
        if (p.shape === "star")         drawStar(ctx, p.x, p.y, radius);
        else if (p.shape === "diamond") drawDiamond(ctx, p.x, p.y, radius);
        else { ctx.arc(p.x, p.y, radius * 0.6, 0, Math.PI * 2); }
        ctx.fill();

        p.x  += p.vx;
        p.y  += p.vy;
        p.vy += 0.06; // gravity
        p.life++;
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur  = 0;
      rafRef.current  = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[9999]"
      aria-hidden="true"
    />
  );
}
