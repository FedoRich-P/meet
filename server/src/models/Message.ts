import { Schema, model } from "mongoose";

export type MessageDocType = {
    id: string;
    name: string;
    text: string;
    socketId: string;
    roomId: string;
    toId?: string | null;
    toName?: string | null;
    attachment?: { name: string; mime: string; dataUrl: string } | null;
    createdAt?: Date;
};

const messageSchema = new Schema<MessageDocType>(
    {
        id: { type: String, required: true, unique: true, index: true },
        name: { type: String, required: true },
        text: { type: String, required: true },
        socketId: { type: String, required: true },
        roomId: { type: String, required: true, index: true },
        toId: { type: String, default: null },
        toName: { type: String, default: null },
        attachment: {
            type: {
                name: { type: String, required: true },
                mime: { type: String, required: true },
                dataUrl: { type: String, required: true },
            },
            required: false,
        },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

export const MessageModel = model<MessageDocType>("Message", messageSchema);
