import "dotenv/config";
import express, { Request, Response } from "express";
import { createServer } from "http";
import cors from "cors";
import fs from "fs";
import path from "path";
import { Server, Socket } from "socket.io";
import { connectDb, isDbReady } from "./db";
import { MessageModel } from "./models/Message";
import { MeetingModel } from "./models/Meeting";

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI?.trim();
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN?.trim().replace(/\/$/, "");

const app = express();
const httpServer = createServer(app);

const allowedOrigins = [
    "https://chat-websocket-beryl.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://localhost:5173",
    "https://127.0.0.1:5173",
];

function extraAllowedOrigins(): string[] {
    const fromEnv = process.env.ALLOWED_ORIGINS?.split(",")
        .map((item) => item.trim().replace(/\/$/, ""))
        .filter(Boolean);
    const list = fromEnv ? [...fromEnv] : [];
    if (PUBLIC_ORIGIN) list.push(PUBLIC_ORIGIN);
    return list;
}

function isDevOrigin(origin?: string): boolean {
    if (!origin) return true;
    const normalized = origin.replace(/\/$/, "");
    if (allowedOrigins.includes(origin) || allowedOrigins.includes(normalized)) return true;
    if (extraAllowedOrigins().includes(normalized)) return true;
    if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) return true;
    if (/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(normalized)) return true;
    return /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(
        origin
    );
}

app.use(
    cors({
        origin: (origin, cb) => {
            if (isDevOrigin(origin)) return cb(null, true);
            return cb(null, false);
        },
        methods: "GET,POST,PUT,DELETE",
        credentials: true,
    })
);

const io = new Server(httpServer, {
    cors: {
        origin: (origin, cb) => {
            if (isDevOrigin(origin)) return cb(null, true);
            return cb(null, false);
        },
        methods: ["GET", "POST"],
        credentials: true,
    },
    maxHttpBufferSize: 3e6,
});

app.use(express.json());

interface Message {
    id: string;
    name: string;
    text: string;
    socketId: string;
    roomId: string;
    toId?: string | null;
    toName?: string | null;
    attachment?: { name: string; mime: string; dataUrl: string } | null;
}

interface User {
    id: string;
    name: string;
    room: string;
    joinedAt: string;
    leftAt: string | null;
    online: boolean;
}

/** Fallback when Mongo is not configured */
const memoryMessages: Record<string, Message[]> = {};
/** Online sockets only (for quick lookup) */
const users = new Map<string, User>();
/** Full roster per room, including who left */
const roomRosters = new Map<string, Map<string, User>>();
const sharingSockets = new Set<string>();

function getRoster(room: string): Map<string, User> {
    let roster = roomRosters.get(room);
    if (!roster) {
        roster = new Map();
        roomRosters.set(room, roster);
    }
    return roster;
}

function listRoster(room: string): User[] {
    return Array.from(getRoster(room).values()).sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.joinedAt.localeCompare(b.joinedAt);
    });
}

function isPresenceSystemText(text: string): boolean {
    return text.includes("присоединился") || text.includes("покинул");
}

async function saveMessage(msg: Message): Promise<void> {
    if (isDbReady()) {
        await MessageModel.updateOne({ id: msg.id }, { $setOnInsert: msg }, { upsert: true });
        await MeetingModel.updateOne(
            { meetingId: msg.roomId },
            {
                $set: { lastActiveAt: new Date() },
                $setOnInsert: { meetingId: msg.roomId, title: "Встреча" },
            },
            { upsert: true }
        );
        return;
    }
    if (!memoryMessages[msg.roomId]) memoryMessages[msg.roomId] = [];
    memoryMessages[msg.roomId].push(msg);
}

async function listMessages(roomId: string): Promise<Message[]> {
    if (isDbReady()) {
        const rows = await MessageModel.find({
            roomId,
            $or: [{ toId: null }, { toId: "" }, { toId: { $exists: false } }],
        }).sort({ createdAt: 1 }).lean();
        return rows
            .filter((r) => !(r.socketId === "system" && isPresenceSystemText(r.text)))
            .map((r) => ({
                id: r.id,
                name: r.name,
                text: r.text,
                socketId: r.socketId,
                roomId: r.roomId,
                attachment: r.attachment ?? null,
            }));
    }
    return (memoryMessages[roomId] || []).filter(
        (msg) => !msg.toId && !(msg.socketId === "system" && isPresenceSystemText(msg.text))
    );
}

async function touchMeeting(
    meetingId: string,
    opts?: { title?: string; organizerName?: string }
): Promise<void> {
    if (!isDbReady()) return;
    const setDoc: Record<string, Date | string> = { lastActiveAt: new Date() };
    if (opts?.title) setDoc.title = opts.title;
    if (opts?.organizerName) setDoc.organizerName = opts.organizerName;

    const setOnInsert: Record<string, string> = { meetingId };
    if (!opts?.title) setOnInsert.title = "Встреча";
    if (!opts?.organizerName) setOnInsert.organizerName = "";

    await MeetingModel.updateOne(
        { meetingId },
        { $set: setDoc, $setOnInsert: setOnInsert },
        { upsert: true }
    );
}

type MeetingMetaType = {
    title: string;
    organizerName: string;
    organizerSocketId: string;
};

const meetingMeta = new Map<string, MeetingMetaType>();
const aloneTimers = new Map<string, ReturnType<typeof setTimeout>>();

function countInRoom(room: string): number {
    let count = 0;
    for (const user of getRoster(room).values()) {
        if (user.online) count += 1;
    }
    return count;
}

function endMeeting(room: string, reason: string): void {
    clearAloneTimer(room);
    io.to(room).emit("meetingEnded", { room, reason });
    for (const [id, user] of users) {
        if (user.room === room) users.delete(id);
    }
    roomRosters.delete(room);
    meetingMeta.delete(room);
}

function clearAloneTimer(room: string): void {
    const prev = aloneTimers.get(room);
    if (prev) clearTimeout(prev);
    aloneTimers.delete(room);
}

const ALONE_IDLE_MS = 5 * 60_000;
const ALONE_WARN_MS = 60_000;

function scheduleAloneEnd(room: string): void {
    clearAloneTimer(room);
    if (countInRoom(room) !== 1) {
        io.to(room).emit("aloneCleared", { room });
        return;
    }
    // 5 minutes alone with no popup, then warn for 1 minute, then end
    const idleTimer = setTimeout(() => {
        if (countInRoom(room) !== 1) {
            aloneTimers.delete(room);
            io.to(room).emit("aloneCleared", { room });
            return;
        }
        io.to(room).emit("aloneWarning", { room, secondsLeft: Math.round(ALONE_WARN_MS / 1000) });
        const endTimer = setTimeout(() => {
            aloneTimers.delete(room);
            if (countInRoom(room) === 1) {
                endMeeting(room, "Встреча завершена: остался один участник");
            }
        }, ALONE_WARN_MS);
        aloneTimers.set(room, endTimer);
    }, ALONE_IDLE_MS);
    aloneTimers.set(room, idleTimer);
}

function extendAloneByFiveMinutes(room: string): void {
    clearAloneTimer(room);
    if (countInRoom(room) !== 1) {
        io.to(room).emit("aloneCleared", { room });
        return;
    }
    io.to(room).emit("aloneCleared", { room });
    const idleTimer = setTimeout(() => {
        if (countInRoom(room) !== 1) {
            aloneTimers.delete(room);
            io.to(room).emit("aloneCleared", { room });
            return;
        }
        io.to(room).emit("aloneWarning", { room, secondsLeft: Math.round(ALONE_WARN_MS / 1000) });
        const endTimer = setTimeout(() => {
            aloneTimers.delete(room);
            if (countInRoom(room) === 1) {
                endMeeting(room, "Встреча завершена: остался один участник");
            }
        }, ALONE_WARN_MS);
        aloneTimers.set(room, endTimer);
    }, ALONE_IDLE_MS);
    aloneTimers.set(room, idleTimer);
}

app.get("/api/meetings/:meetingId", async (req: Request, res: Response) => {
    try {
        const meetingId = req.params.meetingId;
        const mem = meetingMeta.get(meetingId);
        if (isDbReady()) {
            const doc = await MeetingModel.findOne({ meetingId }).lean();
            if (doc) {
                return res.json({
                    meetingId: doc.meetingId,
                    title: doc.title,
                    organizerName: doc.organizerName || mem?.organizerName || null,
                });
            }
        }
        if (mem) {
            return res.json({
                meetingId,
                title: mem.title,
                organizerName: mem.organizerName,
            });
        }
        res.json({ meetingId, title: null, organizerName: null });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load meeting" });
    }
});

app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
        ok: true,
        mongo: isDbReady() ? "connected" : MONGODB_URI ? "connecting-or-failed" : "disabled",
    });
});

app.get("/api/ice", async (_req: Request, res: Response) => {
    type IceServerType = {
        urls: string | string[];
        username?: string;
        credential?: string;
    };
    const fallback: IceServerType[] = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
    ];
    const meteredKey = process.env.METERED_API_KEY?.trim();
    if (!meteredKey) {
        return res.json({ iceServers: fallback });
    }
    try {
        const url = `https://meet.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredKey)}`;
        const response = await fetch(url);
        if (!response.ok) {
            console.warn("Metered TURN credentials failed", response.status);
            return res.json({ iceServers: fallback });
        }
        const data = (await response.json()) as IceServerType[] | { iceServers?: IceServerType[] };
        const iceServers = Array.isArray(data) ? data : data.iceServers;
        if (!iceServers?.length) return res.json({ iceServers: fallback });
        return res.json({ iceServers: [...fallback, ...iceServers] });
    } catch (err) {
        console.warn("Metered TURN fetch error", err);
        return res.json({ iceServers: fallback });
    }
});

app.get("/api/messages", async (req: Request, res: Response) => {
    try {
        const room = (req.query.room as string) || "general";
        const list = await listMessages(room);
        res.json(list);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load messages" });
    }
});

io.on("connection", (socket: Socket) => {
    function emitUsers(room: string) {
        io.to(room).emit("users", listRoster(room));
        scheduleAloneEnd(room);
    }

    function markMemberLeft(socketId: string): User | null {
        const user = users.get(socketId);
        if (!user) return null;
        const leftAt = new Date().toISOString();
        const roster = getRoster(user.room);
        const member = roster.get(socketId);
        if (member) {
            member.online = false;
            member.leftAt = leftAt;
            roster.set(socketId, member);
        }
        users.delete(socketId);
        sharingSockets.delete(socketId);
        return { ...user, online: false, leftAt };
    }

    function upsertMember(socketId: string, name: string, room: string): User {
        const roster = getRoster(room);
        const now = new Date().toISOString();

        for (const [id, member] of [...roster.entries()]) {
            if (!member.online && member.name === name) {
                roster.delete(id);
            }
        }

        const member: User = {
            id: socketId,
            name,
            room,
            joinedAt: now,
            leftAt: null,
            online: true,
        };
        roster.set(socketId, member);
        users.set(socketId, member);
        return member;
    }

    socket.on(
        "newUser",
        async ({
            name,
            room,
            title,
            isOrganizer,
        }: {
            name: string;
            room: string;
            title?: string;
            isOrganizer?: boolean;
        }) => {
            try {
                upsertMember(socket.id, name, room);
                socket.join(room);

                let meta = meetingMeta.get(room);
                if (!meta) {
                    meta = {
                        title: title || `Встреча ${name}`,
                        organizerName: isOrganizer ? name : "",
                        organizerSocketId: isOrganizer ? socket.id : "",
                    };
                    meetingMeta.set(room, meta);
                } else if (isOrganizer && (!meta.organizerSocketId || meta.organizerName === name)) {
                    meta.organizerName = name;
                    meta.organizerSocketId = socket.id;
                    if (title) meta.title = title;
                    meetingMeta.set(room, meta);
                } else if (title && !meta.title) {
                    meta.title = title;
                }

                await touchMeeting(room, {
                    title: meta.title,
                    organizerName: meta.organizerName,
                });

                io.to(room).emit("meetingInfo", {
                    meetingId: room,
                    title: meta.title,
                    organizerName: meta.organizerName,
                    organizerSocketId: meta.organizerSocketId,
                });

                emitUsers(room);
                for (const id of sharingSockets) {
                    const sharer = users.get(id);
                    if (sharer?.room === room && id !== socket.id) {
                        socket.emit("shareState", { from: id, sharing: true });
                    }
                }
            } catch (err) {
                console.error("newUser error", err);
            }
        }
    );

    socket.on("shareState", ({ room, sharing }: { room: string; sharing: boolean }) => {
        const user = users.get(socket.id);
        if (!user || user.room !== room) return;
        if (sharing) sharingSockets.add(socket.id);
        else sharingSockets.delete(socket.id);
        socket.to(room).emit("shareState", { from: socket.id, sharing });
    });

    socket.on("endMeeting", ({ room }: { room: string }) => {
        const meta = meetingMeta.get(room);
        const user = users.get(socket.id);
        const isOrg =
            Boolean(meta) &&
            (meta!.organizerSocketId === socket.id || user?.name === meta!.organizerName);
        if (!isOrg) return;
        endMeeting(room, "Организатор завершил встречу");
    });

    socket.on("extendAlone", ({ room }: { room: string }) => {
        const user = users.get(socket.id);
        if (!user || user.room !== room) return;
        if (countInRoom(room) !== 1) return;
        extendAloneByFiveMinutes(room);
    });

    socket.on("closeAloneRoom", ({ room }: { room: string }) => {
        const user = users.get(socket.id);
        if (!user || user.room !== room) return;
        if (countInRoom(room) !== 1) return;
        endMeeting(room, "Встреча закрыта");
    });

    socket.on("muteAll", ({ room }: { room: string }) => {
        const meta = meetingMeta.get(room);
        if (!meta || meta.organizerSocketId !== socket.id) return;
        io.to(room).emit("forceMute", { from: socket.id, room });
        const msg: Message = {
            id: `mute-${socket.id}-${Date.now()}`,
            name: "Система",
            text: `${meta.organizerName} выключил микрофоны у всех`,
            socketId: "system",
            roomId: room,
        };
        void saveMessage(msg).then(() => io.to(room).emit("message", msg));
    });

    socket.on("speaking", ({ room, speaking }: { room: string; speaking: boolean }) => {
        const user = users.get(socket.id);
        if (!user || user.room !== room) return;
        socket.to(room).emit("speaking", { from: socket.id, speaking: Boolean(speaking) });
    });

    socket.on("sendMessage", async (msg: Message) => {
        try {
            if (!msg?.roomId || !msg?.text?.trim()) return;
            if (msg.attachment?.dataUrl && msg.attachment.dataUrl.length > 1_600_000) return;
            await saveMessage(msg);
            if (msg.toId) {
                msg.socketId = socket.id;
                socket.emit("message", msg);
                const target = users.get(msg.toId);
                if (target && target.room === msg.roomId && msg.toId !== socket.id) {
                    io.to(msg.toId).emit("message", msg);
                }
                return;
            }
            io.to(msg.roomId).emit("message", msg);
        } catch (err) {
            console.error("sendMessage error", err);
        }
    });

    socket.on("clearChat", async ({ room }: { room: string }) => {
        const meta = meetingMeta.get(room);
        const user = users.get(socket.id);
        const isOrg =
            Boolean(meta) &&
            (meta!.organizerSocketId === socket.id || user?.name === meta!.organizerName);
        if (!isOrg) return;
        try {
            if (isDbReady()) {
                await MessageModel.deleteMany({
                    roomId: room,
                    $or: [{ toId: null }, { toId: "" }, { toId: { $exists: false } }],
                });
            }
            memoryMessages[room] = (memoryMessages[room] || []).filter((msg) => Boolean(msg.toId));
            const notice: Message = {
                id: `clear-${socket.id}-${Date.now()}`,
                name: "Система",
                text: `${meta!.organizerName || user?.name || "Организатор"} очистил чат`,
                socketId: "system",
                roomId: room,
            };
            await saveMessage(notice);
            io.to(room).emit("chatCleared", { room, message: notice });
        } catch (err) {
            console.error("clearChat error", err);
        }
    });

    socket.on("leaveChat", () => {
        const user = markMemberLeft(socket.id);
        if (!user) return;
        socket.to(user.room).emit("shareState", { from: socket.id, sharing: false });
        socket.leave(user.room);
        emitUsers(user.room);
    });

    socket.on("disconnect", () => {
        const user = markMemberLeft(socket.id);
        if (!user) return;
        socket.to(user.room).emit("shareState", { from: socket.id, sharing: false });
        socket.leave(user.room);
        emitUsers(user.room);
    });

    socket.on("getUsers", (room: string) => {
        socket.emit("users", listRoster(room));
    });

    socket.on("callUser", ({ userToCall, signal, from, name }) => {
        io.to(userToCall).emit("incomingCall", { signal, from, name });
    });

    socket.on("answerCall", ({ to, signal }) => {
        io.to(to).emit("callAccepted", { signal, from: socket.id });
    });

    socket.on("iceCandidate", ({ to, candidate }) => {
        io.to(to).emit("iceCandidate", { candidate, from: socket.id });
    });

    socket.on("endCall", ({ to }: { to: string }) => {
        io.to(to).emit("callEnded", { from: socket.id });
    });
});

function mountClientApp(): void {
    const clientDist = path.resolve(__dirname, "../../client/dist");
    if (!fs.existsSync(path.join(clientDist, "index.html"))) return;
    app.use(express.static(clientDist));
    app.get("*", (req: Request, res: Response) => {
        if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
            res.status(404).end();
            return;
        }
        res.sendFile(path.join(clientDist, "index.html"));
    });
    console.log("Serving client from", clientDist);
}

async function start(): Promise<void> {
    mountClientApp();
    if (MONGODB_URI) {
        try {
            await Promise.race([
                connectDb(MONGODB_URI),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("MongoDB connect timeout (25s)")), 25000)
                ),
            ]);
        } catch (err) {
            console.error("MongoDB connection failed — falling back to memory", err);
        }
    } else {
        console.warn("MONGODB_URI not set — messages stored in memory only");
    }

    httpServer.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

void start();
