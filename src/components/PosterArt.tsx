import { useState } from 'react';
import { platform } from '../data/platforms';

/**
 * Renders real artwork when the feed has it, and falls back to generated art
 * when it doesn't — or when the image fails to load, which matters because
 * artwork URLs come from a third party and can rot between refreshes.
 *
 * The fallback is deterministic: the same title always gets the same art, so
 * the page looks composed rather than random, and stable across visits.
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
  /** Real artwork above the fold shouldn't wait for the lazy loader. */
  eager?: boolean;
}

export function PosterArt({ title, platformId, imageUrl, className = 'art', quiet, eager }: Props) {
  const [failed, setFailed] = useState(false);

  if (imageUrl && !failed) {
    return (
      <img
        className={`${className} art--photo`}
        src={imageUrl}
        alt={`${title} poster`}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
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
          '--a2': `hsl(${hash(platformId + title) % 360}deg 45% ${lift}%)`,
          filter: `hue-rotate(${shift * 0.25}deg)`,
        } as React.CSSProperties
      }
    >
      {!quiet && <span className="art__text">{title}</span>}
    </div>
  );
}
