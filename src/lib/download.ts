/**
 * Hands a generated file to the browser.
 *
 * The object URL is revoked on a later tick rather than immediately after the
 * click: some browsers haven't started reading the blob by the time the
 * synchronous call returns, and revoking early cancels the download outright.
 */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
