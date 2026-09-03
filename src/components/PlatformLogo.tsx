import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { inkOn, platform } from '../data/platforms';

/**
 * On a board like this, the platform mark is the wayfinding — people don't read
 * "Netflix", they spot the red N. So the real logo matters, and it comes from
 * TMDB's watch-provider data via `scripts/fetch-logos.mjs`: the same source as
 * the rest of the feed, and the only one that actually carries JioHotstar,
 * SonyLIV, Sun NXT, hoichoi and aha alongside the global services.
 *
 * Until that runs — and whenever a logo 404s — a monogram in the brand colour
 * takes over. It's a deliberate lockup, not a broken-image gap.
 */

type LogoMap = Record<string, string>;

const LogoContext = createContext<LogoMap>({});

export function LogoProvider({ children }: { children: ReactNode }) {
  const [logos, setLogos] = useState<LogoMap>({});

  useEffect(() => {
    const controller = new AbortController();
    fetch(new URL('data/logos.json', document.baseURI).href, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: LogoMap) => setLogos(data ?? {}))
      // Logos are an enhancement; the monogram lockup is a complete fallback.
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return <LogoContext.Provider value={logos}>{children}</LogoContext.Provider>;
}

interface Props {
  platformId: string;
  /** Rendered box size in px. */
  size?: number;
  className?: string;
}

export function PlatformLogo({ platformId, size = 22, className = '' }: Props) {
  const logos = useContext(LogoContext);
  const [failed, setFailed] = useState(false);
  const p = platform(platformId);
  const url = logos[platformId];

  const style = {
    '--logo-size': `${size}px`,
    '--pa': p.accent,
    '--pb': p.accent2 ?? p.accent,
    '--ink': inkOn(p.accent),
  } as React.CSSProperties;

  if (url && !failed) {
    return (
      <span className={`logo-box ${className}`} style={style}>
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </span>
    );
  }

  return (
    <span
      className={`logo-box logo-box--mark ${className}`}
      style={style}
      data-len={p.mark.length}
      aria-hidden="true"
    >
      {p.mark}
    </span>
  );
}
