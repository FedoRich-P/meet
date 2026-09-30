import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
    FaCheck,
    FaChevronLeft,
    FaChevronRight,
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

const SIDEBAR_WIDTH_KEY = "meet_sidebar_width";
const SIDEBAR_DEFAULT = 400;
const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 640;

function loadSidebarWidth(): number {
    try {
        const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
        const n = raw ? Number(raw) : SIDEBAR_DEFAULT;
        if (!Number.isFinite(n)) return SIDEBAR_DEFAULT;
        return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
    } catch {
        return SIDEBAR_DEFAULT;
    }
}

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
    const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
    const resizingRef = useRef(false);

    const shareUrl = getMeetingShareUrl(meetingId);
    const sidePanelOpen = chatOpen || peopleOpen;
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

    const onResizePointerMove = useCallback((event: PointerEvent) => {
        if (!resizingRef.current) return;
        const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, window.innerWidth - event.clientX));
        setSidebarWidth(next);
    }, []);

    const stopResize = useCallback(() => {
        if (!resizingRef.current) return;
        resizingRef.current = false;
        document.body.style.cursor = "";
        document.documentElement.style.cursor = "";
        document.body.style.userSelect = "";
        setSidebarWidth((w) => {
            try {
                localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
            } catch {
                // ignore
            }
            return w;
        });
        window.removeEventListener("pointermove", onResizePointerMove);
        window.removeEventListener("pointerup", stopResize);
    }, [onResizePointerMove]);

    function startResize(event: ReactPointerEvent) {
        event.preventDefault();
        resizingRef.current = true;
        document.body.style.cursor = "pointer";
        document.documentElement.style.cursor = "pointer";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", onResizePointerMove);
        window.addEventListener("pointerup", stopResize);
    }

    useEffect(() => {
        return () => {
            window.removeEventListener("pointermove", onResizePointerMove);
            window.removeEventListener("pointerup", stopResize);
        };
    }, [onResizePointerMove, stopResize]);

    async function copyLink() {
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch {
            window.prompt("Скопируйте ссылку на встречу:", shareUrl);
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

    const subtitle = organizerName ? `(организатор ${organizerName})` : null;

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
                    <p className="truncate font-mono text-[10px] text-tg-text-muted" title={shareUrl}>
                        {meetingId}
                    </p>
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
                    className={`relative min-h-0 shrink-0 flex-col border-l border-tg-border bg-tg-surface ${
                        sidePanelOpen ? "flex w-full md:[width:var(--sidebar-width)]" : "hidden"
                    }`}
                    style={{ ["--sidebar-width" as string]: `${sidebarWidth}px` }}
                    aria-hidden={!sidePanelOpen}
                >
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Изменить ширину панели"
                        onPointerDown={startResize}
                        className="group absolute inset-y-0 left-0 z-20 hidden w-3 -translate-x-1/2 cursor-pointer items-center justify-center md:flex"
                    >
                        <span className="flex h-10 items-center gap-0.5 rounded-full bg-tg-surface-2 px-0.5 text-[9px] text-tg-text-muted opacity-40 transition group-hover:bg-tg-panel group-hover:text-tg-accent group-hover:opacity-100 group-active:opacity-100">
                            <FaChevronLeft className="h-2.5 w-2.5" />
                            <FaChevronRight className="h-2.5 w-2.5" />
                        </span>
                    </div>

                    {peopleVisible ? (
                        <>
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
                        </>
                    ) : null}

                    <div
                        className={`min-h-0 flex-1 flex-col ${chatVisible ? "flex" : "hidden"}`}
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
            className={`inline-flex cursor-pointer items-center justify-center rounded-xl p-2.5 leading-none transition hover:brightness-110 active:scale-95 [&_svg]:block [&_svg]:h-4 [&_svg]:w-4 ${className} ${
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
