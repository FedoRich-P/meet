import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useSocket } from "../../shared";
import type { RootState } from "../../app/store.ts";
import type { User } from "../../shared/types.ts";

type ParticipantsPanelProps = {
    onOpenChat: (user: { id: string; name: string }) => void;
    hideHeader?: boolean;
};

function formatTime(iso?: string | null): string {
    if (!iso) return "";
    try {
        return new Date(iso).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return "";
    }
}

function statusLabel(user: User): string {
    const online = user.online !== false && !user.leftAt;
    if (online) {
        const joined = formatTime(user.joinedAt);
        return joined ? `присоединился в ${joined}` : "в сети";
    }
    const left = formatTime(user.leftAt);
    return left ? `вышел в ${left}` : "вышел";
}

export function ParticipantsPanel({ onOpenChat, hideHeader = false }: ParticipantsPanelProps) {
    const socket = useSocket();
    const [users, setUsers] = useState<User[]>([]);
    const room = useSelector((state: RootState) => state.user.room);

    useEffect(() => {
        const handleUsers = (next: User[]) => setUsers(next);
        socket.on("users", handleUsers);
        if (room) socket.emit("getUsers", room);
        return () => {
            socket.off("users", handleUsers);
        };
    }, [socket, room]);

    const onlineCount = users.filter((u) => u.online !== false && !u.leftAt).length;

    return (
        <div className="flex h-full flex-col bg-tg-surface">
            {!hideHeader && (
                <div className="flex h-12 items-center border-b border-tg-border px-4 text-sm font-semibold">
                    Участники
                    <span className="ml-2 rounded-full bg-tg-surface-2 px-2 py-0.5 text-xs text-tg-text-muted">
                        {onlineCount}
                    </span>
                </div>
            )}
            <p className="px-4 pt-3 text-center text-[11px] leading-snug text-tg-text-muted">
                Кликните, чтобы написать личное сообщение
            </p>
            <ul className="tg-scrollbar flex-1 space-y-1 overflow-y-auto p-3">
                {users.length === 0 ? (
                    <li className="px-2 py-6 text-center text-sm text-tg-text-muted">Пока никого нет</li>
                ) : (
                    users.map((user) => {
                        const isSelf = user.id === socket.id;
                        const online = user.online !== false && !user.leftAt;
                        return (
                            <li key={user.id}>
                                <button
                                    type="button"
                                    disabled={isSelf || !online}
                                    onClick={() => {
                                        if (!isSelf && online) onOpenChat({ id: user.id, name: user.name });
                                    }}
                                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                                        isSelf || !online
                                            ? "cursor-default opacity-80"
                                            : "hover:bg-tg-surface-2"
                                    }`}
                                >
                                    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tg-bubble-out text-sm font-semibold uppercase">
                                        {user.name.slice(0, 1)}
                                        <span
                                            className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-tg-surface ${
                                                online ? "bg-tg-online" : "bg-tg-text-muted"
                                            }`}
                                        />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">
                                            {user.name}
                                            {isSelf ? " (вы)" : ""}
                                        </span>
                                        <span
                                            className={`block truncate text-[11px] ${
                                                online ? "text-tg-text-muted" : "text-tg-warning"
                                            }`}
                                        >
                                            ({statusLabel(user)})
                                        </span>
                                    </span>
                                </button>
                            </li>
                        );
                    })
                )}
            </ul>
        </div>
    );
}
