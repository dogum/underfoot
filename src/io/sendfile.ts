/**
 * The phone's share sheet for exports. A browser that can share files gets a
 * Share button beside each file in the Export menu; the export then goes to
 * the share sheet in place of a download. Shared files are the same files.
 * If the sheet can't take one, or sharing fails, the file downloads as before.
 */
const SHARE = { next: false };

/** this browser's share sheet takes a file like this one */
export function canShareFile(name: string, type: string): boolean {
  try {
    return !!navigator.canShare && navigator.canShare({ files: [new File(['x'], name, { type })] });
  } catch {
    return false;
  }
}

/** run an export with its file going to the share sheet */
export function shareNext(run: () => void) {
  SHARE.next = true;
  try {
    run();
  } finally {
    SHARE.next = false;
  }
}

/** called by the download: true once, when the file is to be shared instead */
export function takeShare(): boolean {
  const s = SHARE.next;
  SHARE.next = false;
  return s;
}

export async function shareFile(name: string, text: string, type: string, fallback: () => void) {
  const file = new File([text], name, { type });
  if (!canShareFile(name, type)) return fallback();
  try {
    await navigator.share({ files: [file], title: name });
  } catch (e) {
    /* closing the sheet is a choice, not a failure */
    if ((e as Error).name !== 'AbortError') fallback();
  }
}
