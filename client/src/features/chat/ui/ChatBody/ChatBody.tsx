import { useEffect, useRef } from "react";
import { useSocket } from "../../../../shared";
import type { Message } from "../../../../shared/types.ts";

interface ChatBodyProps {
    messages: Message[];
}

function formatTime(id: string): string {
    const ts = Number(id.split("-").pop());
    if (!Number.isFinite(ts)) {
        return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    }
    return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function ChatBody({ messages }: ChatBodyProps) {
    const socket = useSocket();
    const bottomRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    return (
        <div className="tg-scrollbar tg-chat-bg flex-1 overflow-y-auto px-3 py-4 sm:px-4">
            {messages.length === 0 ? (
                <p className="py-10 text-center text-sm text-tg-text-muted">
                    Напишите первое сообщение во встрече
                </p>
            ) : (
                <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
                    {messages.map((element) => {
                        const isSystem = element.socketId === "system" || element.name === "Система";
                        const isMine = element.socketId === socket.id;

                        if (isSystem) {
                            return (
                                <div key={element.id} className="my-2 flex justify-center">
                                    <span className="rounded-full bg-black/35 px-3 py-1 text-xs text-tg-text-muted backdrop-blur-sm">
                                        {element.text}
                                    </span>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={element.id}
                                className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                            >
                                <div
                                    className={`relative max-w-[85%] rounded-2xl px-3 py-2 shadow-sm sm:max-w-[75%] ${
                                        isMine
                                            ? "rounded-br-md bg-tg-bubble-out text-tg-text"
                                            : "rounded-bl-md bg-tg-bubble-in text-tg-text"
                                    }`}
                                >
                                    {!isMine && (
                                        <p className="mb-0.5 text-xs font-semibold text-tg-accent">
                                            {element.name}
                                        </p>
                                    )}
                                    {element.attachment?.dataUrl ? (
                                        element.attachment.mime.startsWith("image/") ? (
                                            <a href={element.attachment.dataUrl} target="_blank" rel="noreferrer">
                                                <img
                                                    src={element.attachment.dataUrl}
                                                    alt={element.attachment.name}
                                                    className="mb-1 max-h-52 rounded-lg"
                                                />
                                            </a>
                                        ) : (
                                            <a
                                                href={element.attachment.dataUrl}
                                                download={element.attachment.name}
                                                className="mb-1 block text-sm underline"
                                            >
                                                {element.attachment.name}
                                            </a>
                                        )
                                    ) : (
                                        <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">
                                            {element.text}
                                        </p>
                                    )}
                                    <p
                                        className={`mt-1 text-right text-[10px] ${
                                            isMine ? "text-white/55" : "text-tg-text-muted"
                                        }`}
                                    >
                                        {formatTime(element.id)}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={bottomRef} />
                </div>
            )}
        </div>
    );
}
