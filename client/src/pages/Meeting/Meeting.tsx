import { type FormEvent, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router";
import { clearMessages, setRoom, setUser } from "../../entities";
import { userNameSelector } from "../../entities/user/userSlice.ts";
import { PATH } from "../../app/paths";
import { useSocket } from "../../shared";
import type { RootState } from "../../app/store.ts";
import { MeetingShell } from "../../widgets/MeetingShell/MeetingShell.tsx";

export function Meeting() {
    const { meetingId = "" } = useParams<{ meetingId: string }>();
    const navigate = useNavigate();
    const socket = useSocket();
    const dispatch = useDispatch();
    const storedName = useSelector(userNameSelector);
    const room = useSelector((state: RootState) => state.user.room);

    /** Prefill only — do not auto-join until user submits the gate form */
    const [nameInput, setNameInput] = useState(() => localStorage.getItem("user") ?? "");
    const [gatePassed, setGatePassed] = useState(false);
    const joinedRef = useRef(false);

    useEffect(() => {
        if (!meetingId) {
            navigate(PATH.HOME, { replace: true });
            return;
        }
        try {
            if (sessionStorage.getItem(`meet_ended:${meetingId}`)) {
                navigate(PATH.HOME, { replace: true });
                return;
            }
        } catch {
            // ignore
        }
        dispatch(setRoom(meetingId));
        joinedRef.current = false;
        setGatePassed(false);
    }, [meetingId, dispatch, navigate]);

    useEffect(() => {
        if (!gatePassed || !meetingId || !storedName) return;
        if (room !== meetingId) return;

        const isOrganizer = localStorage.getItem(`meet_org:${meetingId}`) === storedName;

        const join = () => {
            if (joinedRef.current) return;
            const title = localStorage.getItem(`meet_title:${meetingId}`) || undefined;
            socket.emit("newUser", { name: storedName, room: meetingId, title, isOrganizer });
            joinedRef.current = true;
        };

        if (socket.connected) {
            join();
        } else {
            socket.once("connect", join);
        }

        const onReconnect = () => {
            if (!joinedRef.current) return;
            const title = localStorage.getItem(`meet_title:${meetingId}`) || undefined;
            socket.emit("newUser", {
                name: storedName,
                room: meetingId,
                title,
                isOrganizer,
            });
        };
        socket.on("connect", onReconnect);

        return () => {
            socket.off("connect", join);
            socket.off("connect", onReconnect);
        };
    }, [gatePassed, meetingId, storedName, room, socket]);

    useEffect(() => {
        const onEnded = ({ room, reason }: { room: string; reason: string }) => {
            if (room !== meetingId) return;
            try {
                sessionStorage.setItem("meet_notice", reason);
                sessionStorage.setItem(`meet_ended:${meetingId}`, "1");
            } catch {
                // ignore
            }
            dispatch(clearMessages());
            joinedRef.current = false;
            setGatePassed(false);
            navigate(PATH.HOME, { replace: true });
        };
        socket.on("meetingEnded", onEnded);
        return () => {
            socket.off("meetingEnded", onEnded);
        };
    }, [socket, meetingId, dispatch, navigate]);

    function handleJoinGate(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const name = nameInput.trim();
        if (!name || !meetingId) return;

        localStorage.setItem("user", name);
        dispatch(setUser(name));
        dispatch(setRoom(meetingId));
        setGatePassed(true);
    }

    function handleLeave() {
        socket.emit("leaveChat");
        dispatch(clearMessages());
        joinedRef.current = false;
        setGatePassed(false);
        navigate(PATH.HOME, { replace: true });
    }

    if (!meetingId) return null;

    if (!gatePassed || !storedName) {
        return (
            <div className="flex min-h-full items-center justify-center bg-tg-bg px-4">
                <form
                    onSubmit={handleJoinGate}
                    className="w-full max-w-sm rounded-2xl border border-tg-surface-2 bg-tg-surface p-6 shadow-xl"
                >
                    <h1 className="text-xl font-semibold text-tg-text">Встреча</h1>
                    <p className="mt-1 text-sm text-tg-text-muted">Как вас показать участникам?</p>
                    {!socket.connected && (
                        <p className="mt-3 text-xs text-tg-warning">Подключение к серверу…</p>
                    )}
                    <input
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder="Ваше имя"
                        className="mt-5 w-full rounded-xl border border-tg-surface-2 bg-tg-bg px-4 py-3 text-tg-text outline-none focus:border-tg-accent"
                        autoFocus
                        autoComplete="nickname"
                    />
                    <button
                        type="submit"
                        className="mt-4 w-full rounded-xl bg-tg-accent py-3 text-sm font-semibold text-white hover:bg-tg-accent-hover"
                    >
                        Войти во встречу
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate(PATH.HOME)}
                        className="mt-2 w-full py-2 text-sm text-tg-text-muted hover:text-tg-text"
                    >
                        На главную
                    </button>
                </form>
            </div>
        );
    }

    return <MeetingShell meetingId={meetingId} onLeave={handleLeave} />;
}
