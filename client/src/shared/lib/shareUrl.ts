function isLocalOrPrivateHost(hostname: string): boolean {
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname)) return true;
    return false;
}

/** Meeting links must use a host guests can open (never LAN IP from dev env). */
export function getShareOrigin(): string {
    const configured = import.meta.env.VITE_PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
    if (configured) {
        try {
            if (!isLocalOrPrivateHost(new URL(configured).hostname)) return configured;
        } catch {
            // ignore bad URL
        }
    }
    return window.location.origin;
}

export function getMeetingShareUrl(meetingId: string): string {
    return `${getShareOrigin()}/m/${meetingId}`;
}

export function redirectToPublicOriginIfNeeded(): void {
    const publicOrigin = import.meta.env.VITE_PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
    if (!publicOrigin) return;
    try {
        if (isLocalOrPrivateHost(new URL(publicOrigin).hostname)) return;
    } catch {
        return;
    }
    const { hostname, pathname, search, hash } = window.location;
    if (!isLocalOrPrivateHost(hostname)) return;
    window.location.replace(`${publicOrigin}${pathname}${search}${hash}`);
}
