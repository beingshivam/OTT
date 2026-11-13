/**
 * The browser half of "Notify me when it streams" — see worker/push.js.
 *
 * The service worker is registered only when someone taps Notify, never on
 * page load: a reader who never asks for notifications never gets a worker.
 * Which titles this device follows is mirrored in localStorage purely so the
 * button can show its state; the server is the record.
 */

const FOLLOWED = 'newonott.follows';

export type PushSupport = 'ok' | 'ios-install' | 'unsupported';

/** Whether this browser can receive web push, and if not, why. iPhone Safari
 *  can, but only for a site added to the Home Screen (iOS 16.4+). */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok';
  if (ios && !standalone) return 'ios-install';
  return 'unsupported';
}

function readFollowed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FOLLOWED) ?? '[]'));
  } catch {
    return new Set();
  }
}
function writeFollowed(s: Set<string>) {
  try {
    localStorage.setItem(FOLLOWED, JSON.stringify([...s]));
  } catch {
    /* Private mode: the follow still exists server-side. */
  }
}

export const isFollowing = (titleId: string) => readFollowed().has(titleId);

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function subscription(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  const { publicKey } = await (await fetch('/api/push/key')).json();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
}

export type FollowResult = 'following' | 'denied' | 'failed';

/** Asks for permission (the browser's own prompt), subscribes, and registers
 *  the follow. Must be called from a tap — browsers refuse the prompt otherwise. */
export async function follow(t: { id: string; title: string; slug?: string }): Promise<FollowResult> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';
    const sub = await subscription();
    const res = await fetch('/api/push/follow', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, titleId: t.id, title: t.title, slug: t.slug }),
    });
    if (!res.ok) return 'failed';
    const s = readFollowed();
    s.add(t.id);
    writeFollowed(s);
    return 'following';
  } catch {
    return 'failed';
  }
}

export async function unfollow(titleId: string): Promise<void> {
  const s = readFollowed();
  s.delete(titleId);
  writeFollowed(s);
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await fetch('/api/push/unfollow', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, titleId }),
    });
  } catch {
    /* Best effort: a stale follow only ever produces one notification. */
  }
}
