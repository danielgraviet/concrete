/** `/s/<shareId>` routing without a router dependency. */

const SHARE_ROUTE = /^\/s\/([A-Za-z0-9_-]{1,128})\/?$/;

/** The share id for a `/s/:shareId` pathname, else null. */
export function parseShareRoute(pathname: string): string | null {
  const match = SHARE_ROUTE.exec(pathname);
  return match ? match[1] : null;
}

export function shareUrl(origin: string, shareId: string): string {
  return `${origin.replace(/\/+$/, '')}/s/${encodeURIComponent(shareId)}`;
}
