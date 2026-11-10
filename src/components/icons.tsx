// The few glyphs the chrome needs, drawn on a 16-unit grid in the current colour.
import type { ReactNode } from "react";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const MinusIcon = () => (
  <Icon>
    <path d="M3 8h10" />
  </Icon>
);

// Four corners pulling in: fit the drawing to the view.
export const FitIcon = () => (
  <Icon>
    <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon size={14}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Icon>
);

export const ThemeIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5v11a5.5 5.5 0 0 0 0-11Z" fill="currentColor" stroke="none" />
  </Icon>
);

export const CopyIcon = () => (
  <Icon size={13}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
  </Icon>
);

// The roofline from the favicon.
export const Mark = () => (
  <svg className="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden>
    <rect x="1" y="1" width="30" height="30" rx="8" className="mark-plate" />
    <path d="M8 22V10l8 6 8-6v12" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);
