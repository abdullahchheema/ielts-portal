/**
 * Server-side validation for teacher-supplied meeting and recording links (spec §45, §47).
 * Pure functions, no I/O: given a string, decide whether it is an acceptable Zoom join link
 * or Google Drive file link, and for Drive, extract a stable file id. Neither function trusts
 * an arbitrary external URL just because it starts with https:// — the host must match, and
 * (for Drive) the path/query shape must carry a recognisable file id.
 */

export type LinkCheck = { valid: true } | { valid: false; reason: string };
export type DriveLinkCheck = { valid: true; fileId: string | null } | { valid: false; reason: string };

function parseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

const isZoomHost = (host: string) => host === 'zoom.us' || host.endsWith('.zoom.us');

/** Accepts only an https Zoom URL (zoom.us or any subdomain, e.g. us02web.zoom.us). */
export function parseZoomUrl(input: string): LinkCheck {
  const url = parseUrl(input);
  if (!url) return { valid: false, reason: 'Not a valid URL.' };
  if (url.protocol !== 'https:') return { valid: false, reason: 'Use an https:// link.' };
  if (!isZoomHost(url.hostname)) return { valid: false, reason: 'This does not look like a Zoom link (expected a zoom.us address).' };
  return { valid: true };
}

const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{10,}$/;

/**
 * Accepts only an https drive.google.com URL that plausibly points at one file (not a whole
 * folder — a lecture recording is a single file). Returns the extracted file id when the URL
 * shape yields one; a valid-but-unparseable id is still accepted (fileId: null) since playback
 * only ever depends on the link's own sharing permissions, not on this extraction.
 */
export function parseDriveUrl(input: string): DriveLinkCheck {
  const url = parseUrl(input);
  if (!url) return { valid: false, reason: 'Not a valid URL.' };
  if (url.protocol !== 'https:') return { valid: false, reason: 'Use an https:// link.' };
  if (url.hostname !== 'drive.google.com') return { valid: false, reason: 'This does not look like a Google Drive link (expected a drive.google.com address).' };
  if (/^\/drive\/folders\//.test(url.pathname)) return { valid: false, reason: 'This is a folder link. Share the link to the individual recording file.' };

  const fileSegmentMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
  if (fileSegmentMatch && DRIVE_FILE_ID_RE.test(fileSegmentMatch[1])) return { valid: true, fileId: fileSegmentMatch[1] };

  const idParam = url.searchParams.get('id');
  if (idParam && DRIVE_FILE_ID_RE.test(idParam)) return { valid: true, fileId: idParam };

  // Recognisably a Drive file link (host and scheme are right) but the id could not be pulled
  // out reliably — accept it rather than reject a link that will still work for students.
  if (/^\/file\/d\//.test(url.pathname) || /^\/open$/.test(url.pathname) || /^\/uc$/.test(url.pathname)) return { valid: true, fileId: null };

  return { valid: false, reason: 'This Google Drive link does not look like a file share link.' };
}
