'use client';
// Closing mark of the site entry: a 3×3 patch of stone with the centre tile missing; on entering the viewport the
// last tile drops into place, echoing the hero stage. Reduced motion shows the finished patch.
import { useEffect, useRef, useState } from 'react';

export function ClosingTile() {
  const root = useRef<HTMLSpanElement>(null), [set, setSet] = useState(false);
  useEffect(() => {
    const node = root.current; if (!node) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setSet(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setTimeout(() => setSet(true), 250); observer.disconnect(); }
    }, { threshold: 1 });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  return <span ref={root} className="closing-tile" data-set={set || undefined} aria-hidden="true">
    {Array.from({ length: 9 }, (_, i) => <i key={i} className={i === 4 ? 'closing-tile__last' : undefined}/>)}
  </span>;
}
