/** Prefer shared LAN HTTPS origin so PC and phone use the same link. */
export function getShareOrigin(): string {
    const configured = import.meta.env.VITE_PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
    if (configured) return configured;
    return window.location.origin;
}

export function getMeetingShareUrl(meetingId: string): string {
    return `${getShareOrigin()}/m/${meetingId}`;
}

export function redirectToPublicOriginIfNeeded(): void {
    const publicOrigin = import.meta.env.VITE_PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
    if (!publicOrigin) return;
    const { hostname, pathname, search, hash } = window.location;
    if (hostname !== "localhost" && hostname !== "127.0.0.1") return;
    window.location.replace(`${publicOrigin}${pathname}${search}${hash}`);
}
