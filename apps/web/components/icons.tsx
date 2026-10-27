export function Icon({ name, size = 20 }: { name: 'home' | 'plus' | 'arrow' | 'close' | 'grid' | 'layers' | 'exit' | 'check' | 'search' | 'back'; size?: number }) {
  const paths: Record<typeof name, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v11H3Z"/><path d="M8 21V11l4-3 4 3v10M3 10l9 6 9-6"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    back: <path d="M19 12H5m6-6-6 6 6 6"/>, close: <path d="m5 5 14 14M19 5 5 19"/>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    layers: <path d="m12 3 10 5-10 5L2 8Zm-10 10 10 5 10-5M2 18l10 5 10-5"/>,
    exit: <><path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4"/></>,
    check: <path d="m5 12 4 4L19 6"/>, search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function Brand() { return <span className="brand"><Icon name="home" size={28}/><span>hestia<span className="brand-dot">.</span></span></span>; }
