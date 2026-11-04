'use client';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Horizontal chip/swatch rails. Touch already scrolls natively; this adds what a mouse lacks with hidden
 * scrollbars (drag to scroll, vertical wheel scrolls sideways), edge fades that show more items are off-screen,
 * and keeps the pressed item in view when `active` changes. A drag never also counts as a click.
 */
export function useRail<T extends HTMLElement>(active?: unknown) {
  const node = useRef<T | null>(null), cleanup = useRef<() => void>(undefined);
  const ref = useCallback((element: T | null) => {
    cleanup.current?.(); cleanup.current = undefined; node.current = element;
    if (!element) return;
    element.dataset.rail = '';
    const edges = () => {
      const max = element.scrollWidth - element.clientWidth;
      element.toggleAttribute('data-more-start', element.scrollLeft > 2);
      element.toggleAttribute('data-more-end', max - element.scrollLeft > 2);
    };
    let drag: { x: number; left: number; moved: boolean; id: number } | undefined;
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || element.scrollWidth <= element.clientWidth) return;
      drag = { x: event.clientX, left: element.scrollLeft, moved: false, id: event.pointerId };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 4) { drag.moved = true; element.setPointerCapture(drag.id); element.style.cursor = 'grabbing'; }
      if (drag.moved) element.scrollLeft = drag.left - dx;
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const moved = drag.moved; drag = undefined; element.style.cursor = '';
      // Swallow the click that follows a drag so dragging over a chip does not select it.
      if (moved) element.addEventListener('click', swallow, { capture: true, once: true });
    };
    const swallow = (event: Event) => { event.stopPropagation(); event.preventDefault(); };
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || element.scrollWidth <= element.clientWidth) return;
      const before = element.scrollLeft; element.scrollLeft += event.deltaY;
      if (element.scrollLeft !== before) event.preventDefault();
    };
    element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up); element.addEventListener('pointercancel', up);
    element.addEventListener('wheel', wheel, { passive: false }); element.addEventListener('scroll', edges, { passive: true });
    const observer = new ResizeObserver(edges); observer.observe(element);
    const children = new MutationObserver(edges); children.observe(element, { childList: true });
    edges();
    cleanup.current = () => {
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', up);
      element.removeEventListener('wheel', wheel); element.removeEventListener('scroll', edges);
      observer.disconnect(); children.disconnect();
    };
  }, []);
  useEffect(() => {
    const element = node.current;
    const pressed = element?.querySelector<HTMLElement>('[aria-pressed=true], [aria-selected=true], .is-active');
    if (element && pressed) {
      const left = pressed.offsetLeft - element.offsetLeft, right = left + pressed.offsetWidth;
      if (left < element.scrollLeft + 24 || right > element.scrollLeft + element.clientWidth - 24)
        element.scrollTo({ left: Math.max(0, left - (element.clientWidth - pressed.offsetWidth) / 2), behavior: 'smooth' });
    }
  }, [active]);
  useEffect(() => () => cleanup.current?.(), []);
  return ref;
}
