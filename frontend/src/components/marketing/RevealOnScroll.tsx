"use client";

import { useEffect } from "react";
import { animate } from "framer-motion";

/** Fades the landing's `[data-reveal]` cards up as they scroll into view,
 * staggered within a row (DESIGN.md §10). The server renders them visible:
 * only cards still below the fold are hidden, after hydration, so nothing
 * on screen flickers and the page reads fine without JavaScript. Reduced
 * motion leaves everything as it is. */
export function RevealOnScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const pending = [...document.querySelectorAll<HTMLElement>("[data-reveal]")].filter((el) => el.getBoundingClientRect().top > window.innerHeight);
    for (const el of pending) el.style.opacity = "0";
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const siblings = el.parentElement ? [...el.parentElement.querySelectorAll(":scope > [data-reveal]")] : [];
          animate(el, { opacity: [0, 1], y: [18, 0] }, { duration: 0.55, delay: Math.max(0, siblings.indexOf(el)) * 0.07, ease: [0.22, 1, 0.36, 1] });
          io.unobserve(el);
        }
      },
      { threshold: 0.15 },
    );
    for (const el of pending) io.observe(el);
    return () => {
      io.disconnect();
      for (const el of pending) el.style.opacity = "";
    };
  }, []);
  return null;
}
