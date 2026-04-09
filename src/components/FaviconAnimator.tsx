"use client";

import { useEffect } from "react";

export default function FaviconAnimator() {
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const video = document.createElement("video");
    video.src = "/images/bolt.webm";
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    let rafId: number;

    const drawFrame = () => {
      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(video, 0, 0, 64, 64);

      const favicon =
        document.querySelector<HTMLLinkElement>("link[rel~='icon']") ??
        (() => {
          const el = document.createElement("link");
          el.rel = "icon";
          document.head.appendChild(el);
          return el;
        })();

      favicon.href = canvas.toDataURL("image/png");
      rafId = requestAnimationFrame(drawFrame);
    };

    video.addEventListener("playing", drawFrame, { once: true });
    video.play().catch(() => {
      // autoplay blocked — fall back to static GIF
    });

    return () => {
      cancelAnimationFrame(rafId);
      video.pause();
    };
  }, []);

  return null;
}
