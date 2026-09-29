export interface MessageAttachment {
    name: string;
    mime: string;
    dataUrl: string;
}

export interface Message {
    id: string;
    name: string;
    text: string;
    socketId?: string;
    roomId: string;
    toId?: string | null;
    toName?: string | null;
    attachment?: MessageAttachment | null;
}

export interface User {
    id: string;
    name: string;
    room: string;
}