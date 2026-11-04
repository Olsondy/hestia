'use client';
import { useRef } from 'react';
import { flushSync } from 'react-dom';

/** Bottom-sheet heights: just the grip and title, the default summary, or the full details. */
export type SheetState = 'min' | 'normal' | 'expanded';

/**
 * Draggable sheet grip. While dragging, the panel follows the finger; on release it snaps one step in the drag
 * direction (two steps for a long drag) and animates from where it was let go to the new state's size. A tap or
 * keyboard activation (click) steps min → normal → expanded → normal. A drag never also counts as a click.
 */
export function useSheetDrag(state: SheetState, setState: (next: SheetState) => void) {
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; height: number; id: number; moved: boolean }>(undefined);
  const suppressClick = useRef(false);
  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const element = panel.current; if (!element || event.button > 0) return;
    drag.current = { y: event.clientY, height: element.getBoundingClientRect().height, id: event.pointerId, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const d = drag.current, element = panel.current;
    if (!d || !element || event.pointerId !== d.id) return;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    element.style.transition = 'none'; element.style.maxHeight = 'none';
    element.style.height = `${Math.min(innerHeight * .86, Math.max(72, d.height - dy))}px`;
  };
  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const d = drag.current, element = panel.current; drag.current = undefined;
    if (!d || !element || !d.moved) return;
    suppressClick.current = true;
    const dy = event.clientY - d.y, long = Math.abs(dy) > 260;
    const next: SheetState = dy < -40 ? (state === 'min' && !long ? 'normal' : 'expanded')
      : dy > 40 ? (state === 'expanded' && !long ? 'normal' : 'min') : state;
    const from = element.getBoundingClientRect().height;
    flushSync(() => setState(next));
    // FLIP: measure the new state's natural size, then animate from the released height to it.
    element.style.height = ''; element.style.maxHeight = '';
    const to = element.getBoundingClientRect().height;
    element.style.maxHeight = 'none'; element.style.height = `${from}px`; void element.offsetHeight;
    element.style.transition = 'height var(--d-slow) var(--ease)'; element.style.height = `${to}px`;
    let cleared = false;
    const done = () => { if (cleared) return; cleared = true; element.style.height = ''; element.style.maxHeight = ''; element.style.transition = ''; };
    element.addEventListener('transitionend', done, { once: true }); setTimeout(done, 700);
  };
  const onClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setState(state === 'min' ? 'normal' : state === 'normal' ? 'expanded' : 'normal');
  };
  return { panel, grip: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClick } };
}
