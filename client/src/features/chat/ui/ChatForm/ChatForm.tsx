import { type ChangeEvent, type FormEvent, type KeyboardEvent, useEffect, useRef } from "react";
import { LuPaperclip, LuSend } from "react-icons/lu";

interface Props {
    handleSubmit: (e: FormEvent<HTMLFormElement>) => void;
    setMessage: (value: string) => void;
    message: string;
    onAttach: (file: File) => void;
    attachError: string | null;
    placeholder?: string;
}

const MIN_COMPOSER_HEIGHT = 90;
const MAX_COMPOSER_HEIGHT = 250;

export function ChatForm({ handleSubmit, setMessage, message, onAttach, attachError, placeholder = "Сообщение" }: Props) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const textRef = useRef<HTMLTextAreaElement | null>(null);

    function syncHeight() {
        const el = textRef.current;
        if (!el) return;
        el.style.height = "0px";
        const needed = el.scrollHeight;
        const next = Math.min(Math.max(needed, MIN_COMPOSER_HEIGHT), MAX_COMPOSER_HEIGHT);
        el.style.height = `${next}px`;
        el.style.overflowY = needed > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
    }

    useEffect(() => {
        syncHeight();
    }, [message]);

    function handleMessage(event: ChangeEvent<HTMLTextAreaElement>) {
        setMessage(event.target.value);
    }

    function handleFile(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) onAttach(file);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
        }
    }

    return (
        <form onSubmit={handleSubmit} className="shrink-0 border-t border-tg-border bg-tg-header px-3 pb-2 pt-3">
            <div className="flex items-end gap-2">
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tg-surface-2 p-0 text-tg-text ring-1 ring-white/15 transition hover:bg-tg-panel hover:text-tg-accent"
                    title="Прикрепить файл до 900 КБ"
                    aria-label="Прикрепить файл"
                >
                    <LuPaperclip className="h-[18px] w-[18px]" strokeWidth={2.25} />
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx,.txt,.zip,.rar"
                    onChange={handleFile}
                />

                <div className="min-w-0 flex-1">
                    {attachError && (
                        <p className="mb-1 px-1 text-xs text-tg-danger" role="alert">
                            {attachError}
                        </p>
                    )}
                    <textarea
                        ref={textRef}
                        rows={1}
                        value={message}
                        onChange={handleMessage}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        style={{ height: MIN_COMPOSER_HEIGHT }}
                        className="box-border block w-full resize-none rounded-2xl border border-tg-surface-2 bg-tg-bg px-4 py-3 text-left text-[15px] leading-snug text-tg-text outline-none placeholder:text-tg-text-muted focus:border-tg-accent"
                        autoComplete="off"
                    />
                </div>

                <button
                    type="submit"
                    disabled={!message.trim()}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tg-accent p-0 text-white transition hover:bg-tg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Отправить"
                >
                    <span className="flex h-6 w-6 items-center justify-center">
                        <LuSend
                            className="h-5 w-5"
                            strokeWidth={2}
                            style={{ transform: "translate(-0.5px, 1px)" }}
                        />
                    </span>
                </button>
            </div>
            <p className="mt-1.5 text-center text-[11px] leading-none text-tg-text-muted">
                Shift+Enter — перенос строки
            </p>
        </form>
    );
}
