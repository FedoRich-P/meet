import { SocketProvider as BaseSocketProvider } from "../../shared/lib/socket/SocketContext";
import { io } from "socket.io-client";
import type { ReactNode } from "react";

/** Empty VITE_API_URL → same origin (Vite proxy in dev). */
const apiUrl = import.meta.env.VITE_API_URL?.trim() || undefined;

const socket = io(apiUrl, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    autoConnect: true,
});

type Props = {
    children: ReactNode;
};

export function SocketProvider({ children }: Props) {
    return <BaseSocketProvider value={socket}>{children}</BaseSocketProvider>;
}
