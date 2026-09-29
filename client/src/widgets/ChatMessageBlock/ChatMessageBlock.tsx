import { useEffect, useState } from "react";
import { ChatBody } from "../../features/chat/ui/ChatBody/ChatBody.tsx";
import { ChatForm } from "../../features/chat/ui/ChatForm/ChatForm.tsx";
import { useChatMessages } from "../../features/chat/model/useChatMessages.ts";
import { useChatLogic } from "../../features/chat/model/useChatLogic.ts";
import { useSocket } from "../../shared";

type ChatMessageBlockProps = {
    meetingId: string;
    canClear: boolean;
    peer: { id: string; name: string } | null;
    onClosePeer: () => void;
    onSelectPeer: (peer: { id: string; name: string }) => void;
};

export function ChatMessageBlock({
    meetingId,
    canClear,
    peer,
    onClosePeer,
    onSelectPeer,
}: ChatMessageBlockProps) {
    const socket = useSocket();
    const [activePeer, setActivePeer] = useState(peer);
    useEffect(() => {
        setActivePeer(peer);
    }, [peer]);

    const { message, handleMessage, handleSubmit, handleAttach, attachError } = useChatLogic(activePeer);
    const { messages, isLoading } = useChatMessages();
    const selfId = socket.id ?? "";
    const visible = messages.filter((item) => {
        if (!activePeer) return !item.toId;
        const mine = item.socketId === selfId && item.toId === activePeer.id;
        const theirs = item.socketId === activePeer.id && item.toId === selfId;
        return mine || theirs;
    });
    const threads = new Map<string, string>();
    for (const item of messages) {
        if (!item.toId || !item.socketId || item.socketId === "system") continue;
        if (item.socketId === selfId) threads.set(item.toId, item.toName || "Участник");
        if (item.toId === selfId) threads.set(item.socketId, item.name);
    }
    if (activePeer?.id) threads.set(activePeer.id, activePeer.name);

    function showGeneral() {
        setActivePeer(null);
        onClosePeer();
    }

    function showThread(id: string, threadName: string) {
        const next = { id, name: threadName };
        setActivePeer(next);
        onSelectPeer(next);
    }

    function clearChat() {
        if (!canClear) return;
        const ok = window.confirm("Очистить чат для всех участников этой встречи?");
        if (!ok) return;
        socket.emit("clearChat", { room: meetingId });
    }

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-tg-text-muted">
                Загрузка сообщений…
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-tg-border px-2 py-2">
                <button
                    type="button"
                    onClick={showGeneral}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs ${
                        activePeer ? "bg-tg-surface-2 text-tg-text-muted" : "bg-tg-accent text-white"
                    }`}
                >
                    Общий
                </button>
                {[...threads.entries()].map(([id, threadName]) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => showThread(id, threadName)}
                        className={`shrink-0 rounded-full px-3 py-1 text-xs ${
                            activePeer?.id === id ? "bg-tg-accent text-white" : "bg-tg-surface-2 text-tg-text"
                        }`}
                    >
                        {threadName}
                    </button>
                ))}
            </div>
            {activePeer ? (
                <div className="flex shrink-0 items-center justify-between border-b border-tg-border px-3 py-1.5">
                    <span className="truncate text-xs text-tg-text">Лично: {activePeer.name}</span>
                    <button type="button" onClick={showGeneral} className="text-xs text-tg-accent">
                        Общий чат
                    </button>
                </div>
            ) : canClear ? (
                <div className="flex shrink-0 justify-end border-b border-tg-border px-3 py-1.5">
                    <button
                        type="button"
                        onClick={clearChat}
                        className="text-xs text-tg-text-muted hover:text-tg-danger"
                    >
                        Очистить чат
                    </button>
                </div>
            ) : null}
            <ChatBody messages={visible} />
            <ChatForm
                handleSubmit={handleSubmit}
                setMessage={handleMessage}
                message={message}
                onAttach={handleAttach}
                attachError={attachError}
                placeholder={activePeer ? `Сообщение для ${activePeer.name}` : "Сообщение"}
            />
        </div>
    );
}
