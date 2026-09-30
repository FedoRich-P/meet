import type { User } from "../types.ts";

export type UsersPayloadType = User[] | { room?: string; users?: User[] };

/** Normalize socket "users" payload (legacy array or { room, users }). */
export function parseUsersPayload(payload: UsersPayloadType): { room: string | null; users: User[] } {
    if (Array.isArray(payload)) {
        return { room: null, users: payload };
    }
    if (payload && typeof payload === "object" && Array.isArray(payload.users)) {
        return { room: payload.room ?? null, users: payload.users };
    }
    return { room: null, users: [] };
}
