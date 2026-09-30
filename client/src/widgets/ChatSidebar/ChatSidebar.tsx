import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useSocket } from "../../shared";
import type { RootState } from "../../app/store.ts";
import type { User } from "../../shared/types.ts";
import { parseUsersPayload } from "../../shared/lib/usersPayload.ts";

/** @deprecated Prefer ParticipantsPanel — kept for legacy imports */
export function ChatSidebar() {
    const socket = useSocket();
    const [users, setUsers] = useState<User[]>([]);
    const { room } = useSelector((state: RootState) => state.user);

    useEffect(() => {
        const handleUsers = (payload: unknown) => {
            const parsed = parseUsersPayload(payload as Parameters<typeof parseUsersPayload>[0]);
            if (parsed.room && room && parsed.room !== room) return;
            setUsers(parsed.users);
        };
        socket.on("users", handleUsers);
        if (room) socket.emit("getUsers", room);
        return () => {
            socket.off("users", handleUsers);
        };
    }, [socket, room]);

    return (
        <aside className="flex w-64 flex-col border-l border-tg-border bg-tg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-tg-text">Участники</h2>
            <ul className="space-y-2 overflow-y-auto">
                {users.map((user) => (
                    <li key={user.id} className="rounded-lg px-2 py-1.5 text-sm text-tg-text">
                        {user.name}
                        {user.id === socket.id ? " (вы)" : ""}
                    </li>
                ))}
            </ul>
        </aside>
    );
}
