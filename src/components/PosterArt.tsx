import { platform } from '../data/platforms';

/**
 * Most weekly-calendar rows arrive before anyone has published artwork, and a
 * wall of grey placeholders kills the page. So every title gets a deterministic
 * generated poster keyed off its name and platform — same title, same art, every
 * visit — and the real image simply takes over once the feed has one.
 */

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

interface Props {
  title: string;
  platformId: string;
  imageUrl?: string;
  className?: string;
  /** Suppress the typographic title (used behind a sheet that prints its own). */
  quiet?: boolean;
}

export function PosterArt({ title, platformId, imageUrl, className = 'art', quiet }: Props) {
  if (imageUrl) {
    return (
      <img
        className={className}
        src={imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
  }

  const accent = platform(platformId).accent;
  const h = hash(title);
  // Rotate a second hue away from the platform accent so cards on the same
  // platform still read as distinct without leaving the brand's neighbourhood.
  const shift = (h % 70) - 35;
  const lift = 14 + (h % 18);

  return (
    <div
      className={className}
      style={
        {
          '--a1': `color-mix(in oklab, ${accent} ${55 + (h % 20)}%, #1a1024)`,
          '--a2': `hsl(${(hash(platformId + title) % 360)}deg 45% ${lift}%)`,
          filter: `hue-rotate(${shift * 0.25}deg)`,
        } as React.CSSProperties
      }
    >
      {!quiet && <span className="art__text">{title}</span>}
    </div>
  );
}
