import { useEffect, useState, type ReactNode } from "react";
import {
    FaCheck,
    FaComments,
    FaCopy,
    FaTimes,
    FaUsers,
    FaVideo,
} from "react-icons/fa";
import { useSelector } from "react-redux";
import type { RootState } from "../../app/store.ts";
import { useSocket } from "../../shared";
import { ChatMessageBlock } from "../../features/chat";
import { CallPanel } from "../../features/call/CallPanel.tsx";
import { ParticipantsPanel } from "../ParticipantsPanel/ParticipantsPanel.tsx";
import { getMeetingShareUrl } from "../../shared/lib/shareUrl.ts";
import { loadMeetingTitle, saveMeetingTitle } from "../../shared/lib/meetingMeta.ts";
import type { Message } from "../../shared/types.ts";

type MeetingShellProps = {
    meetingId: string;
    onLeave: () => void;
};

type MobileTab = "call" | "chat" | "people";

type MeetingInfoType = {
    title: string;
    organizerName: string;
    organizerSocketId: string;
};

export function MeetingShell({ meetingId, onLeave }: MeetingShellProps) {
    const socket = useSocket();
    const userName = useSelector((state: RootState) => state.user.name);
    const [copied, setCopied] = useState(false);
    const [mobileTab, setMobileTab] = useState<MobileTab>("call");
    const [chatOpen, setChatOpen] = useState(false);
    const [peopleOpen, setPeopleOpen] = useState(false);
    const [localSocketId, setLocalSocketId] = useState(() => socket.id ?? "");
    const [meetingTitle, setMeetingTitle] = useState(
        () => loadMeetingTitle(meetingId) || "Встреча"
    );
    const [organizerName, setOrganizerName] = useState(() => {
        try {
            return localStorage.getItem(`meet_org:${meetingId}`) || "";
        } catch {
            return "";
        }
    });
    const [organizerSocketId, setOrganizerSocketId] = useState("");
    const [unread, setUnread] = useState(0);
    const [dmPeer, setDmPeer] = useState<{ id: string; name: string } | null>(null);
    const [aloneSeconds, setAloneSeconds] = useState<number | null>(null);

    const shareUrl = getMeetingShareUrl(meetingId);
    const chatVisible = chatOpen;
    const peopleVisible = peopleOpen;
    const isOrganizer = Boolean(organizerSocketId) && localSocketId === organizerSocketId;

    function showPeople() {
        if (peopleOpen) {
            setPeopleOpen(false);
            setMobileTab("call");
            return;
        }
        setPeopleOpen(true);
        setChatOpen(false);
        setMobileTab("people");
    }

    function showChat() {
        if (chatOpen) {
            setChatOpen(false);
            setMobileTab("call");
            return;
        }
        setChatOpen(true);
        setPeopleOpen(false);
        setMobileTab("chat");
    }

    function openDirectChat(user: { id: string; name: string }) {
        setDmPeer(user);
        setChatOpen(true);
        setPeopleOpen(false);
        setMobileTab("chat");
    }

    useEffect(() => {
        const syncId = () => {
            if (socket.id) setLocalSocketId(socket.id);
        };
        syncId();
        socket.on("connect", syncId);
        return () => {
            socket.off("connect", syncId);
        };
    }, [socket]);

    useEffect(() => {
        const cached = loadMeetingTitle(meetingId);
        if (cached) setMeetingTitle(cached);

        void fetch(`/api/meetings/${encodeURIComponent(meetingId)}`)
            .then((r) => r.json())
            .then(
                (data: {
                    title?: string | null;
                    organizerName?: string | null;
                }) => {
                    if (data?.title) {
                        setMeetingTitle(data.title);
                        saveMeetingTitle(meetingId, data.title);
                    }
                    if (data?.organizerName) setOrganizerName(data.organizerName);
                }
            )
            .catch(() => undefined);

        const onInfo = ({
            meetingId: id,
            title,
            organizerName: org,
            organizerSocketId: orgId,
        }: MeetingInfoType & { meetingId: string }) => {
            if (id !== meetingId) return;
            if (title) {
                setMeetingTitle(title);
                saveMeetingTitle(meetingId, title);
            }
            if (org) setOrganizerName(org);
            if (orgId) setOrganizerSocketId(orgId);
        };
        socket.on("meetingInfo", onInfo);
        return () => {
            socket.off("meetingInfo", onInfo);
        };
    }, [meetingId, socket]);

    useEffect(() => {
        const onMessage = (msg: Message) => {
            if (msg.roomId && msg.roomId !== meetingId) return;
            const isMine = msg.socketId === socket.id;
            const isSystem = msg.socketId === "system" || msg.name === "Система";
            if (msg.toId && msg.toId === socket.id && msg.socketId && msg.socketId !== socket.id) {
                setDmPeer({ id: msg.socketId, name: msg.name });
                setChatOpen(true);
                setPeopleOpen(false);
                setMobileTab("chat");
            }
            if (isMine || isSystem) return;
            if (!chatVisible) setUnread((n) => n + 1);
        };
        socket.on("message", onMessage);
        return () => {
            socket.off("message", onMessage);
        };
    }, [socket, meetingId, chatVisible]);

    useEffect(() => {
        if (chatVisible) setUnread(0);
    }, [chatVisible]);

    useEffect(() => {
        const onWarn = ({ room, secondsLeft }: { room: string; secondsLeft: number }) => {
            if (room !== meetingId) return;
            setAloneSeconds(secondsLeft);
        };
        const onCleared = ({ room }: { room: string }) => {
            if (room !== meetingId) return;
            setAloneSeconds(null);
        };
        socket.on("aloneWarning", onWarn);
        socket.on("aloneCleared", onCleared);
        return () => {
            socket.off("aloneWarning", onWarn);
            socket.off("aloneCleared", onCleared);
        };
    }, [socket, meetingId]);

    useEffect(() => {
        if (aloneSeconds == null) return;
        const timer = window.setInterval(() => {
            setAloneSeconds((prev) => {
                if (prev == null || prev <= 1) return prev;
                return prev - 1;
            });
        }, 1000);
        return () => window.clearInterval(timer);
        // restart only when dialog appears / disappears
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aloneSeconds == null]);

    async function copyLink() {
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // ignore
        }
    }

    function muteAll() {
        if (!isOrganizer) return;
        socket.emit("muteAll", { room: meetingId });
    }

    function endMeeting() {
        if (!isOrganizer) return;
        const ok = window.confirm("Завершить встречу для всех участников?");
        if (!ok) return;
        socket.emit("endMeeting", { room: meetingId });
    }

    function extendAlone() {
        setAloneSeconds(null);
        socket.emit("extendAlone", { room: meetingId });
    }

    function closeAloneRoom() {
        socket.emit("closeAloneRoom", { room: meetingId });
        setAloneSeconds(null);
        onLeave();
    }

    const callPanel = localSocketId ? (
        <CallPanel
            localUserId={localSocketId}
            localUserName={userName ?? "Вы"}
            roomId={meetingId}
            isOrganizer={isOrganizer}
            onLeave={onLeave}
            onMuteAll={muteAll}
        />
    ) : (
        <div className="flex h-full items-center justify-center bg-black text-sm text-white/70">
            Подключение к серверу…
        </div>
    );

    const subtitle = organizerName ? `(орг. ${organizerName})` : null;

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-tg-bg text-tg-text">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-tg-border bg-tg-header px-3 sm:gap-3 sm:px-4">
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-sm font-semibold sm:text-base">
                        {meetingTitle}
                        {subtitle ? (
                            <span className="ml-1.5 font-normal text-tg-text-muted">{subtitle}</span>
                        ) : null}
                    </h1>
                </div>

                <button
                    type="button"
                    onClick={copyLink}
                    className="inline-flex items-center gap-2 rounded-xl bg-tg-surface-2 px-3 py-2 text-xs font-medium text-tg-text transition hover:bg-tg-panel [&_svg]:block [&_svg]:h-3.5 [&_svg]:w-3.5"
                >
                    {copied ? <FaCheck className="text-tg-online" /> : <FaCopy />}
                    <span className="hidden sm:inline">{copied ? "Скопировано" : "Ссылка"}</span>
                </button>

                <HeaderToggle
                    active={peopleOpen}
                    onClick={showPeople}
                    label="Участники"
                    className="hidden md:inline-flex"
                >
                    <FaUsers />
                </HeaderToggle>

                <HeaderToggle
                    active={chatOpen}
                    onClick={showChat}
                    label="Чат"
                    className="relative hidden md:inline-flex"
                    badge={unread}
                >
                    <FaComments />
                </HeaderToggle>

                {isOrganizer && (
                    <button
                        type="button"
                        onClick={endMeeting}
                        className="inline-flex items-center rounded-xl bg-tg-danger px-3 py-2 text-xs font-semibold text-white hover:bg-tg-danger-hover"
                    >
                        Завершить встречу
                    </button>
                )}
            </header>

            <div className="flex min-h-0 flex-1">
                <section
                    className={`relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black ${
                        mobileTab === "call" ? "block" : "hidden md:block"
                    }`}
                >
                    <div className="absolute inset-0">{callPanel}</div>
                </section>

                <aside
                    className={`min-h-0 shrink-0 flex-col border-l border-tg-border bg-tg-surface ${
                        peopleVisible ? "flex w-full md:w-72" : "hidden"
                    }`}
                >
                    <PanelHeader
                        title="Участники"
                        onClose={() => {
                            setPeopleOpen(false);
                            if (mobileTab === "people") setMobileTab("call");
                        }}
                        className="hidden md:flex"
                    />
                    <div className="min-h-0 flex-1">
                        <ParticipantsPanel onOpenChat={openDirectChat} hideHeader />
                    </div>
                </aside>

                {/* Always mounted so unread/chat subscription survives close */}
                <aside
                    className={`min-h-0 shrink-0 flex-col border-l border-tg-border bg-tg-surface ${
                        chatVisible ? "flex w-full md:w-[520px]" : "hidden"
                    }`}
                    aria-hidden={!chatVisible}
                >
                    <PanelHeader
                        title="Чат встречи"
                        onClose={() => {
                            setChatOpen(false);
                            if (mobileTab === "chat") setMobileTab("call");
                        }}
                        className="hidden md:flex"
                    />
                    <div className="min-h-0 flex-1">
                        <ChatMessageBlock
                            meetingId={meetingId}
                            canClear={isOrganizer && !dmPeer}
                            peer={dmPeer}
                            onClosePeer={() => setDmPeer(null)}
                            onSelectPeer={openDirectChat}
                        />
                    </div>
                </aside>
            </div>

            <nav className="flex shrink-0 border-t border-tg-border bg-tg-header pb-[env(safe-area-inset-bottom)] md:hidden">
                {(
                    [
                        { id: "call" as const, label: "Звонок", icon: FaVideo },
                        { id: "chat" as const, label: "Чат", icon: FaComments },
                        { id: "people" as const, label: "Люди", icon: FaUsers },
                    ] as const
                ).map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => {
                            setMobileTab(id);
                            setChatOpen(id === "chat");
                            setPeopleOpen(id === "people");
                        }}
                        className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] ${
                            mobileTab === id ? "text-tg-accent" : "text-tg-text-muted"
                        }`}
                    >
                        <Icon className="text-base" />
                        {label}
                        {id === "chat" && unread > 0 && (
                            <span className="absolute right-[28%] top-1 min-w-4 rounded-full bg-tg-accent px-1 text-[10px] font-bold text-white">
                                {unread > 9 ? "9+" : unread}
                            </span>
                        )}
                    </button>
                ))}
            </nav>

            {aloneSeconds != null && aloneSeconds > 0 && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
                    <div
                        role="dialog"
                        aria-modal="true"
                        className="w-full max-w-sm rounded-2xl border border-tg-surface-2 bg-tg-surface p-5 shadow-2xl"
                    >
                        <h2 className="text-lg font-semibold text-tg-text">Вы остались одни</h2>
                        <p className="mt-2 text-sm leading-relaxed text-tg-text-muted">
                            Уже 5 минут во встрече один участник. Встреча закроется через{" "}
                            <span className="font-semibold text-tg-warning">
                                {Math.floor(aloneSeconds / 60)}:
                                {String(aloneSeconds % 60).padStart(2, "0")}
                            </span>
                            .
                        </p>
                        <div className="mt-5 flex flex-col gap-2">
                            <button
                                type="button"
                                onClick={extendAlone}
                                className="w-full rounded-xl bg-tg-accent py-3 text-sm font-semibold text-white hover:bg-tg-accent-hover"
                            >
                                Подождать ещё 5 минут
                            </button>
                            <button
                                type="button"
                                onClick={closeAloneRoom}
                                className="w-full rounded-xl bg-tg-danger py-3 text-sm font-semibold text-white hover:bg-tg-danger-hover"
                            >
                                Закрыть встречу
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function PanelHeader({
    title,
    onClose,
    className = "flex",
}: {
    title: string;
    onClose: () => void;
    className?: string;
}) {
    return (
        <div
            className={`h-12 shrink-0 items-center justify-between border-b border-tg-border px-4 ${className}`}
        >
            <span className="text-sm font-semibold">{title}</span>
            <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-tg-text-muted hover:bg-tg-surface-2 hover:text-tg-text"
                aria-label="Закрыть"
            >
                <FaTimes />
            </button>
        </div>
    );
}

function HeaderToggle({
    active,
    onClick,
    label,
    children,
    className = "",
    badge = 0,
}: {
    active: boolean;
    onClick: () => void;
    label: string;
    children: ReactNode;
    className?: string;
    badge?: number;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={label}
            aria-label={label}
            aria-pressed={active}
            className={`inline-flex items-center justify-center rounded-xl p-2.5 leading-none transition [&_svg]:block [&_svg]:h-4 [&_svg]:w-4 ${className} ${
                active ? "bg-tg-accent text-white" : "bg-tg-surface-2 text-tg-text hover:bg-tg-panel"
            }`}
        >
            {children}
            {badge > 0 && (
                <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-tg-danger px-1 text-[10px] font-bold text-white">
                    {badge > 9 ? "9+" : badge}
                </span>
            )}
        </button>
    );
}
