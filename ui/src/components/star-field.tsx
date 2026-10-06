"use client";

import { useEffect, useRef } from "react";

type Star = { x: number; y: number; radius: number; alpha: number; drift: number };

const STAR_DENSITY = 1 / 9000; // stars per pixel of viewport, keeping a phone as sparse as a monitor
const MAX_STARS = 220;

// The reference's background canvas. Purely decorative, so it is aria-hidden, sits behind everything, and
// stops entirely for a viewer who asked for reduced motion - a full-screen animation that never stops is
// exactly what that setting is for.
export function StarField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stars: Star[] = [];
    let frame = 0;

    const resize = (): void => {
      // Cap the backing store at 2x: a 4K canvas repainted every frame is a lot of work for decoration.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * ratio);
      canvas.height = Math.floor(window.innerHeight * ratio);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const count = Math.min(MAX_STARS, Math.round(window.innerWidth * window.innerHeight * STAR_DENSITY));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        radius: Math.random() * 1.1 + 0.3,
        alpha: Math.random() * 0.5 + 0.2,
        drift: Math.random() * 0.02 + 0.004,
      }));
    };

    const paint = (): void => {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const star of stars) {
        context.beginPath();
        context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(224, 242, 254, ${star.alpha})`;
        context.fill();
      }
    };

    const tick = (): void => {
      for (const star of stars) {
        // A slow downward drift, wrapping at the bottom: a starfield, not a snowstorm.
        star.y += star.drift;
        if (star.y > window.innerHeight) star.y = 0;
        star.alpha += (Math.random() - 0.5) * 0.02;
        star.alpha = Math.min(0.75, Math.max(0.15, star.alpha));
      }
      paint();
      frame = window.requestAnimationFrame(tick);
    };

    resize();
    if (reduceMotion) paint();
    else frame = window.requestAnimationFrame(tick);

    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
