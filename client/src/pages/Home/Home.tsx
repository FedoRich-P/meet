import { type FormEvent, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router";
import { setRoom, setUser } from "../../entities";
import { PATH } from "../../app/paths";
import { createMeetingIdFromTitle, saveMeetingTitle } from "../../shared/lib/meetingMeta.ts";

const MEET_NOTICE_MS = 60_000;

export function Home() {
    const [userName, setUserName] = useState(() => localStorage.getItem("user") ?? "");
    const [meetingTitleInput, setMeetingTitleInput] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const navigate = useNavigate();
    const dispatch = useDispatch();

    useEffect(() => {
        try {
            const text = sessionStorage.getItem("meet_notice");
            if (!text) return;
            sessionStorage.removeItem("meet_notice");
            setNotice(text);
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(null), MEET_NOTICE_MS);
        return () => window.clearTimeout(timer);
    }, [notice]);

    function enterMeeting(meetingId: string, name: string, title: string, asOrganizer?: boolean) {
        localStorage.setItem("user", name);
        dispatch(setUser(name));
        dispatch(setRoom(meetingId));
        saveMeetingTitle(meetingId, title);
        if (asOrganizer) {
            localStorage.setItem(`meet_org:${meetingId}`, name);
        }
        navigate(PATH.meeting(meetingId), { state: { autoJoin: true } });
    }

    function handleCreate(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError(null);
        const name = userName.trim();
        const title = meetingTitleInput.trim();
        if (!name) {
            setError("Введите имя");
            return;
        }
        if (!title) {
            setError("Введите название встречи");
            return;
        }
        if (title.length < 2) {
            setError("Название слишком короткое");
            return;
        }
        const meetingId = createMeetingIdFromTitle(title);
        enterMeeting(meetingId, name, title, true);
    }

    return (
        <div className="flex min-h-full flex-col items-center justify-center bg-tg-bg px-4 py-10">
            <div className="w-full max-w-md">
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-tg-accent text-2xl font-bold text-white shadow-lg shadow-tg-accent/30">
                        M
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight text-tg-text">Meet</h1>
                    <p className="mt-2 text-sm text-tg-text-muted">
                        Создайте встречу и отправьте ссылку участникам
                    </p>
                </div>

                <div className="rounded-2xl border border-tg-surface-2 bg-tg-surface p-6 shadow-xl">
                    {notice && (
                        <p className="mb-4 rounded-lg bg-tg-surface-2 px-3 py-2 text-sm text-tg-text" role="status">
                            {notice}
                        </p>
                    )}
                    <label className="mb-4 block">
                        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-tg-text-muted">
                            Ваше имя
                        </span>
                        <input
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            placeholder="Как вас представить"
                            className="w-full rounded-xl border border-tg-surface-2 bg-tg-bg px-4 py-3 text-tg-text outline-none transition placeholder:text-tg-text-muted focus:border-tg-accent"
                            autoComplete="nickname"
                        />
                    </label>

                    {error && (
                        <p className="mb-3 rounded-lg bg-tg-danger/15 px-3 py-2 text-sm text-tg-danger" role="alert">
                            {error}
                        </p>
                    )}

                    <form onSubmit={handleCreate} className="flex flex-col gap-3">
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-tg-text-muted">
                                Название встречи (обязательно)
                            </span>
                            <input
                                value={meetingTitleInput}
                                onChange={(e) => setMeetingTitleInput(e.target.value)}
                                placeholder="Например: Стендап команды"
                                required
                                className="w-full rounded-xl border border-tg-surface-2 bg-tg-bg px-4 py-3 text-tg-text outline-none transition placeholder:text-tg-text-muted focus:border-tg-accent"
                            />
                        </label>
                        <button
                            type="submit"
                            className="w-full rounded-xl bg-tg-accent py-3.5 text-sm font-semibold text-white transition hover:bg-tg-accent-hover"
                        >
                            Создать встречу
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
