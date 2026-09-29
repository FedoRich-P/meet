/** Human-readable meeting id + title from creator name and local time. */

export function slugifyName(name: string): string {
    const map: Record<string, string> = {
        а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
        и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
        с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
        ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
    };

    const base = name
        .trim()
        .toLowerCase()
        .split("")
        .map((ch) => map[ch] ?? ch)
        .join("")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24);

    return base || "meet";
}

export function formatMeetingStamp(date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}-${pad(date.getHours())}.${pad(date.getMinutes())}`;
}

export function formatMeetingTitle(creatorName: string, date = new Date()): string {
    const when = date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
    return `Встреча ${creatorName} · ${when}`;
}

export function createMeetingId(creatorName: string, date = new Date()): string {
    return `${slugifyName(creatorName)}-${formatMeetingStamp(date)}`;
}

const TITLE_KEY = "meet_title:";

export function saveMeetingTitle(meetingId: string, title: string): void {
    try {
        localStorage.setItem(`${TITLE_KEY}${meetingId}`, title);
    } catch {
        // ignore
    }
}

export function loadMeetingTitle(meetingId: string): string | null {
    try {
        return localStorage.getItem(`${TITLE_KEY}${meetingId}`);
    } catch {
        return null;
    }
}
