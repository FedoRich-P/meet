import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useSocket } from "../../shared";
import type { RootState } from "../../app/store.ts";
import type { User } from "../../shared/types.ts";

type ParticipantsPanelProps = {
    onOpenChat: (user: { id: string; name: string }) => void;
    hideHeader?: boolean;
};

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

    return (
        <div className="flex h-full flex-col bg-tg-surface">
            {!hideHeader && (
                <div className="flex h-12 items-center border-b border-tg-border px-4 text-sm font-semibold">
                    Участники
                    <span className="ml-2 rounded-full bg-tg-surface-2 px-2 py-0.5 text-xs text-tg-text-muted">
                        {users.length}
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
                        return (
                            <li key={user.id}>
                                <button
                                    type="button"
                                    disabled={isSelf}
                                    onClick={() => {
                                        if (!isSelf) onOpenChat({ id: user.id, name: user.name });
                                    }}
                                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-tg-surface-2 ${
                                        isSelf ? "cursor-default" : ""
                                    }`}
                                >
                                    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tg-bubble-out text-sm font-semibold uppercase">
                                        {user.name.slice(0, 1)}
                                        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-tg-surface bg-tg-online" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">
                                            {user.name}
                                            {isSelf ? " (вы)" : ""}
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
