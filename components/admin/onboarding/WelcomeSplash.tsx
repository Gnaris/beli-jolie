"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const FLAG_KEY = "bj_welcome_splash_shown_v1";
const DURATION_MS = 3000;

export default function WelcomeSplash({ shopName }: { shopName: string }) {
  const [mounted, setMounted] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(FLAG_KEY)) return;
    } catch {
      // localStorage inaccessible (mode privé) — on affiche quand même une fois par onglet
    }
    setShow(true);
    const t = setTimeout(() => {
      setShow(false);
      try { window.localStorage.setItem(FLAG_KEY, "1"); } catch { /* ignore */ }
    }, DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  if (!mounted || !show) return null;

  const display = shopName.trim() || "Votre boutique";

  return createPortal(
    <div className="bj-splash" role="dialog" aria-label="Bienvenue" aria-live="polite">
      <div className="bj-splash-halo bj-splash-halo-1" />
      <div className="bj-splash-halo bj-splash-halo-2" />
      <div className="bj-splash-halo bj-splash-halo-3" />
      {[
        { l: "10%", c: "#a78bfa", d: ".2s" },
        { l: "25%", c: "#f472b6", d: ".5s" },
        { l: "45%", c: "#34d399", d: ".1s" },
        { l: "60%", c: "#fbbf24", d: ".7s" },
        { l: "75%", c: "#60a5fa", d: ".3s" },
        { l: "90%", c: "#a78bfa", d: ".4s" },
      ].map((c, i) => (
        <span
          key={i}
          className="bj-splash-confetti"
          style={{ left: c.l, background: c.c, animationDelay: c.d }}
        />
      ))}
      <div className="bj-splash-inner">
        <span className="bj-splash-wave" aria-hidden="true">👋</span>
        <h1 className="bj-splash-title">Bienvenue&nbsp;!</h1>
        <p className="bj-splash-sub">
          <strong>{display}</strong> est prête à être configurée.
        </p>
        <div className="bj-splash-track">
          <div className="bj-splash-fill" />
        </div>
      </div>
      <style jsx>{`
        .bj-splash {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          background:
            radial-gradient(1200px 500px at 90% -10%, rgba(196,181,253,0.55), transparent 60%),
            radial-gradient(1000px 500px at -10% 20%, rgba(167,243,208,0.45), transparent 60%),
            radial-gradient(700px 400px at 60% 100%, rgba(253,230,138,0.40), transparent 60%),
            linear-gradient(180deg, #fbfaf7 0%, #fefdfb 100%);
          animation: bj-splash-out .6s ease-in 2.4s forwards;
        }
        @keyframes bj-splash-out { to { opacity: 0; visibility: hidden; } }
        .bj-splash-inner {
          position: relative; text-align: center; max-width: 32rem;
        }
        .bj-splash-wave {
          display: inline-block; font-size: clamp(3rem, 12vw, 5rem);
          transform-origin: 70% 70%; opacity: 0;
          animation:
            bj-emoji-in .6s cubic-bezier(.34,1.56,.64,1) .1s forwards,
            bj-wave 1.2s ease-in-out .8s infinite;
        }
        @keyframes bj-emoji-in {
          from { opacity: 0; transform: scale(.5) rotate(-30deg); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes bj-wave {
          0%,60%,100% { transform: rotate(0deg); }
          10%,30% { transform: rotate(14deg); }
          20% { transform: rotate(-8deg); }
          40% { transform: rotate(-4deg); }
          50% { transform: rotate(10deg); }
        }
        .bj-splash-title {
          font-family: var(--font-heading, 'Fraunces', serif);
          font-weight: 800; letter-spacing: -0.02em; line-height: .95;
          font-size: clamp(2.4rem, 14vw, 6rem);
          margin: clamp(14px, 3vw, 24px) 0 0;
          background: linear-gradient(135deg, #6d28d9 0%, #4f46e5 50%, #db2777 100%);
          -webkit-background-clip: text; background-clip: text; color: transparent;
          opacity: 0; transform: translateY(20px);
          animation: bj-rise .7s cubic-bezier(.16,1,.3,1) .35s forwards;
        }
        .bj-splash-sub {
          font-size: clamp(14px, 3vw, 16px); color: #4b5563;
          margin: clamp(10px, 2vw, 16px) 0 0;
          opacity: 0; transform: translateY(15px);
          animation: bj-rise .7s cubic-bezier(.16,1,.3,1) .6s forwards;
        }
        .bj-splash-sub strong { color: #6d28d9; }
        @keyframes bj-rise { to { opacity: 1; transform: translateY(0); } }
        .bj-splash-track {
          margin: clamp(20px, 5vw, 36px) auto 0;
          width: clamp(160px, 40vw, 260px); height: 6px;
          background: rgba(0,0,0,.08); border-radius: 999px; overflow: hidden;
          opacity: 0; animation: bj-rise .5s ease-out .9s forwards;
        }
        .bj-splash-fill {
          height: 100%; width: 0%;
          background: linear-gradient(90deg, #8b5cf6, #6366f1, #ec4899);
          border-radius: 999px;
          animation: bj-fill 2.2s cubic-bezier(.4,0,.2,1) .5s forwards;
        }
        @keyframes bj-fill { to { width: 100%; } }
        .bj-splash-halo {
          position: absolute; border-radius: 50%; filter: blur(60px);
          animation: bj-float 6s ease-in-out infinite; pointer-events: none;
        }
        .bj-splash-halo-1 { width: clamp(140px, 30vw, 240px); height: clamp(140px, 30vw, 240px); background: rgba(196,181,253,.5); top: 12%; left: 10%; }
        .bj-splash-halo-2 { width: clamp(120px, 24vw, 180px); height: clamp(120px, 24vw, 180px); background: rgba(253,164,175,.4); bottom: 18%; right: 12%; animation-delay: 2s; }
        .bj-splash-halo-3 { width: clamp(120px, 26vw, 200px); height: clamp(120px, 26vw, 200px); background: rgba(167,243,208,.4); top: 60%; left: 6%; animation-delay: 4s; }
        @keyframes bj-float {
          0%,100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(20px, -20px) scale(1.1); }
        }
        .bj-splash-confetti {
          position: absolute; width: 8px; height: 14px; border-radius: 2px;
          opacity: 0; top: 0; animation: bj-confetti 2s ease-out forwards;
        }
        @keyframes bj-confetti {
          0% { opacity: 0; transform: translateY(-20vh) rotate(0deg); }
          10% { opacity: 1; }
          100% { opacity: 0; transform: translateY(80vh) rotate(540deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .bj-splash-wave, .bj-splash-title, .bj-splash-sub, .bj-splash-track,
          .bj-splash-fill, .bj-splash-halo, .bj-splash-confetti { animation: none !important; opacity: 1 !important; transform: none !important; }
          .bj-splash-fill { width: 100%; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
