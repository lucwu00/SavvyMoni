/**
 * Offer a generated file to the user. Inside a Claude artifact the
 * `downloads` capability asks the viewer to confirm the save; elsewhere a
 * normal browser download is used.
 */
type Saver = { save: (r: { filename: string; data: Blob | Uint8Array | string }) => Promise<{ status: string }> };

let saverPromise: Promise<Saver | null> | null = null;
function saver(): Promise<Saver | null> {
  const host = (globalThis as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!host?.use) return Promise.resolve(null);
  saverPromise ??= host.use('downloads').then((x) => (x as Saver | null) ?? null, () => null);
  return saverPromise;
}

export type SaveOutcome = 'saved' | 'declined' | 'failed';

export async function saveFile(filename: string, data: Uint8Array | string, mime: string): Promise<SaveOutcome> {
  const s = await saver();
  if (s) {
    try {
      await s.save({ filename, data: typeof data === 'string' ? data : new Blob([data as BlobPart], { type: mime }) });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'declined' || code === 'rate_limited') return 'declined';
      // Unavailable in this view: fall back to a normal download below.
    }
  }
  try {
    const blob = new Blob([data as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
