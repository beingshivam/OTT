/** Inline 16px-grid icons. Stroke-based so they inherit colour and stay crisp. */

type P = { className?: string };
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const IconSearch = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base} {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const IconChevronLeft = (p: P) => (
  <svg {...base} {...p}>
    <path d="m14.5 5-7 7 7 7" />
  </svg>
);

export const IconChevronRight = (p: P) => (
  <svg {...base} {...p}>
    <path d="m9.5 5 7 7-7 7" />
  </svg>
);

export const IconChevronDown = (p: P) => (
  <svg {...base} {...p}>
    <path d="m5 9 7 7 7-7" />
  </svg>
);

export const IconSliders = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
);

export const IconFilm = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M8 4v16M16 4v16M3 12h18M3 8h5M3 16h5M16 8h5M16 16h5" />
  </svg>
);

export const IconTv = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="6" width="19" height="12.5" rx="2.5" />
    <path d="m8 2.5 4 3.5 4-3.5" />
  </svg>
);

export const IconDoc = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 3h8l4.5 4.5V21H6z" />
    <path d="M14 3v5h4.5M9 13h6M9 17h4" />
  </svg>
);

export const IconMic = (p: P) => (
  <svg {...base} {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
);

export const IconSparkle = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3.5 13.9 9l5.6 2-5.6 2-1.9 5.5L10.1 13l-5.6-2 5.6-2z" />
  </svg>
);

export const IconTicket = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 8.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2.5 2.5 0 0 0 0 5v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2.5 2.5 0 0 0 0-5z" />
    <path d="M14 7v10" strokeDasharray="2 2.5" />
  </svg>
);

export const IconCalendar = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

export const IconShare = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 15V3.5M8.5 7 12 3.5 15.5 7" />
    <path d="M5 13v5.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V13" />
  </svg>
);

/**
 * The one filled icon in the set, and deliberately so.
 *
 * Everything else here is a stroke on a 24 grid, which is what makes the row
 * of them read as one family. WhatsApp's mark is a solid glyph, and a
 * stroked-outline imitation of it is the thing people fail to recognise — the
 * whole value of putting it on a button is that it is identified before it is
 * read. So it keeps its own construction, and `fill` is set explicitly rather
 * than inherited from `base`.
 */
export const IconWhatsApp = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M17.5 14.4c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.6-.92-2.2-.24-.57-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.87 1.22 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.75-.71 2-1.4.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35M12.05 21.8h-.02a9.8 9.8 0 0 1-4.98-1.36l-.36-.21-3.7.97.99-3.61-.23-.37a9.76 9.76 0 0 1-1.5-5.22c0-5.4 4.4-9.79 9.8-9.79a9.73 9.73 0 0 1 6.92 2.87 9.7 9.7 0 0 1 2.87 6.93c0 5.4-4.4 9.79-9.8 9.79M20.5 3.49A11.8 11.8 0 0 0 12.05 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.59 5.93L.08 24l6.35-1.66a11.8 11.8 0 0 0 5.62 1.43h.01c6.54 0 11.86-5.32 11.87-11.86a11.8 11.8 0 0 0-3.47-8.42" />
  </svg>
);

export const IconExternal = (p: P) => (
  <svg {...base} {...p}>
    <path d="M14 4h6v6M20 4l-8.5 8.5" />
    <path d="M18 14v4.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const IconPlay = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M8 5.2c0-.9 1-1.5 1.8-1l9 6.8c.7.5.7 1.5 0 2l-9 6.8c-.8.5-1.8-.1-1.8-1z" />
  </svg>
);

/**
 * Instagram, drawn on the same stroke grid as everything else rather than
 * pasted from their brand kit. A filled glyph in a row of 1.8px strokes reads
 * as a foreign object, and the official mark comes with usage rules about
 * colour and clear space that a footer link does not need to take on.
 */
export const IconInstagram = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M17.2 6.8h.01" />
  </svg>
);

/**
 * The two layouts, as the shapes they are.
 *
 * Rows and a grid are about the most legible pair of icons in software — every
 * mail client, file browser and photo app uses them for exactly this choice —
 * which is what lets the words drop away on a phone without the control
 * becoming a guess.
 */
export const IconRows = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="4" rx="1.5" />
    <rect x="3" y="10" width="18" height="4" rx="1.5" />
    <rect x="3" y="16" width="18" height="4" rx="1.5" />
  </svg>
);

export const IconGrid = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </svg>
);

export const KIND_ICON = {
  film: IconFilm,
  series: IconTv,
  documentary: IconDoc,
  reality: IconMic,
  anime: IconSparkle,
  special: IconMic,
} as const;

/** An envelope, for the subscribe control in the header. Drawn to the same
 *  24-box and 1.8 stroke as the rest so it sits level with its neighbours. */
export const IconMail = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    <path d="M3 7l8.2 5.6a1.5 1.5 0 0 0 1.6 0L21 7" />
  </svg>
);
