import { useSocket } from "../../../shared";
import { type FormEvent, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../../shared/hooks/hooks.ts";
import { userNameSelector, userRoomSelector } from "../../../entities/user/userSlice.ts";
import { addMessage } from "../../../entities";

const MAX_FILE_BYTES = 900 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") resolve(reader.result);
            else reject(new Error("Не удалось прочитать файл"));
        };
        reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать файл"));
        reader.readAsDataURL(file);
    });
}

export const useChatLogic = (recipient: { id: string; name: string } | null) => {
    const [message, setMessage] = useState("");
    const [attachError, setAttachError] = useState<string | null>(null);
    const socket = useSocket();
    const dispatch = useAppDispatch();

    const name = useAppSelector(userNameSelector);
    const room = useAppSelector(userRoomSelector);

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (message.trim() && name && room && socket.id) {
            const next = {
                id: `${socket.id}-${Date.now()}`,
                name,
                text: message,
                socketId: socket.id,
                roomId: room,
                ...(recipient ? { toId: recipient.id, toName: recipient.name } : {}),
            };
            dispatch(addMessage(next));
            socket.emit("sendMessage", next);
            setMessage("");
            setAttachError(null);
        }
    };

    const handleAttach = (file: File) => {
        if (!name || !room) return;
        if (file.size > MAX_FILE_BYTES) {
            setAttachError("Файл больше 900 КБ. Выберите файл поменьше.");
            return;
        }
        setAttachError(null);
        void readFileAsDataUrl(file)
            .then((dataUrl) => {
            const next = {
                id: `${socket.id}-${Date.now()}`,
                name,
                text: file.name,
                socketId: socket.id,
                roomId: room,
                ...(recipient ? { toId: recipient.id, toName: recipient.name } : {}),
                attachment: {
                    name: file.name,
                    mime: file.type || "application/octet-stream",
                    dataUrl,
                },
            };
            dispatch(addMessage(next));
            socket.emit("sendMessage", next);
            })
            .catch(() => setAttachError("Не удалось прочитать файл"));
    };

    const handleMessage = (value: string) => {
        setMessage(value);
    };

    return {
        message,
        handleMessage,
        handleSubmit,
        handleAttach,
        attachError,
        userName: name,
        currentRoom: room,
    };
};
