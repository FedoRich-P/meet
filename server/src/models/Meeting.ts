import { Schema, model } from "mongoose";

export type MeetingDocType = {
    meetingId: string;
    title: string;
    organizerName: string;
    createdAt?: Date;
    lastActiveAt?: Date;
};

const meetingSchema = new Schema<MeetingDocType>(
    {
        meetingId: { type: String, required: true, unique: true, index: true },
        title: { type: String, default: "Встреча" },
        organizerName: { type: String, default: "" },
        lastActiveAt: { type: Date, default: Date.now },
    },
    { timestamps: { createdAt: true, updatedAt: true } }
);

export const MeetingModel = model<MeetingDocType>("Meeting", meetingSchema);
