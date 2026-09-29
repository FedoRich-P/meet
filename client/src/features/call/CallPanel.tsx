import { useEffect, useRef, useState, type ReactNode } from "react";
import {
    FaCompress,
    FaDesktop,
    FaExpand,
    FaMicrophone,
    FaMicrophoneSlash,
    FaPhoneSlash,
    FaVideo,
    FaVideoSlash,
    FaVolumeMute,
    FaVolumeUp,
} from "react-icons/fa";
import { useMeetingRoom, type PeerTileType } from "../chat/model/useMeetingRoom.ts";

type CallPanelProps = {
    localUserId: string;
    localUserName: string;
    roomId: string;
    isOrganizer: boolean;
    onLeave: () => void;
    onMuteAll: () => void;
};

export function CallPanel({
    localUserId,
    localUserName,
    roomId,
    isOrganizer,
    onLeave,
    onMuteAll,
}: CallPanelProps) {
    const {
        tiles,
        stagePeerId,
        setStagePeerId,
        isMuted,
        isCamOff,
        isSharing,
        mediaError,
        hasLocalMedia,
        isFullscreen,
        connectionHint,
        speakingIds,
        localSpeaking,
        enableMedia,
        toggleMute,
        toggleCam,
        toggleScreenShare,
        toggleFullscreen,
        remoteSoundOff,
        toggleRemoteSound,
    } = useMeetingRoom(localUserId, localUserName, roomId);

    const [needsAudioTap, setNeedsAudioTap] = useState(false);

    useEffect(() => {
        void enableMedia().catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const onNeedTap = () => setNeedsAudioTap(true);
        window.addEventListener("meet-audio-blocked", onNeedTap);
        return () => window.removeEventListener("meet-audio-blocked", onNeedTap);
    }, []);

    function unlockRemoteAudio() {
        setNeedsAudioTap(false);
        window.dispatchEvent(new CustomEvent("meet-unlock-audio"));
    }

    const remoteTiles = tiles.filter((t) => !t.isLocal);
    const stageTile =
        tiles.find((t) => t.id === stagePeerId) ??
        tiles.find((t) => t.isSharing) ??
        tiles.find((t) => !t.isLocal && t.videoEnabled) ??
        tiles.find((t) => !t.isLocal) ??
        tiles[0];

    const stripTiles = tiles.filter((t) => t.id !== stageTile?.id);

    return (
        <div id="meet-stage" className="relative h-full w-full overflow-hidden bg-black">
            <RemoteAudioLayer
                remotes={remoteTiles}
                soundOff={remoteSoundOff}
                onBlocked={() => setNeedsAudioTap(true)}
            />

            <div className="absolute left-3 top-3 z-20 max-w-[40%] rounded-lg bg-black/60 px-2 py-1 text-[11px] text-white/90">
                {connectionHint}
            </div>

            <div
                className="absolute inset-0"
                onClick={() => {
                    if (needsAudioTap) unlockRemoteAudio();
                }}
                onKeyDown={() => undefined}
                role="presentation"
            >
                {stageTile ? (
                    <TileVideo tile={stageTile} variant="stage" speaking={speakingIds.has(stageTile.id)} />
                ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                        <p className="text-lg font-semibold text-white">{localUserName}</p>
                        <p className="text-sm text-white/70">
                            {hasLocalMedia
                                ? "Микрофон выключен, камера выключена"
                                : "Разрешите микрофон. Камера по умолчанию выключена"}
                        </p>
                        {!hasLocalMedia && (
                            <button
                                type="button"
                                onClick={() => void enableMedia()}
                                className="rounded-xl bg-tg-accent px-4 py-2 text-sm font-semibold text-white"
                            >
                                Включить камеру и микрофон
                            </button>
                        )}
                    </div>
                )}

                {stageTile && (
                    <div className="pointer-events-none absolute bottom-24 left-3 z-20 rounded-lg bg-black/55 px-2 py-1 text-xs text-white">
                        {stageTile.name}
                        {stageTile.isSharing ? " · экран" : ""}
                        {speakingIds.has(stageTile.id) ? " · говорит" : ""}
                        {!stageTile.isLocal &&
                        stageTile.connection !== "на связи" &&
                        stageTile.connection !== "подключение…"
                            ? ` · ${stageTile.connection}`
                            : ""}
                    </div>
                )}

                {needsAudioTap && remoteTiles.length > 0 && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            unlockRemoteAudio();
                        }}
                        className="absolute left-1/2 top-1/2 z-30 max-w-[85%] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-black/85 px-4 py-3 text-center text-sm text-white ring-2 ring-tg-online"
                    >
                        Нажмите, чтобы включить звук собеседника
                    </button>
                )}
            </div>

            {stripTiles.length > 0 && (
                <div className="absolute bottom-24 right-3 z-20 flex max-w-[70%] flex-col items-end gap-1">
                    <div className="flex gap-2 overflow-x-auto">
                        {stripTiles.map((tile) => (
                            <button
                                key={tile.id}
                                type="button"
                                onClick={() => setStagePeerId(tile.id)}
                                className={`relative h-20 w-32 shrink-0 overflow-hidden rounded-xl ring-2 transition hover:ring-tg-accent ${
                                    speakingIds.has(tile.id)
                                        ? "animate-pulse ring-tg-online"
                                        : "ring-white/20"
                                }`}
                            >
                                <TileVideo
                                    tile={tile}
                                    variant="thumb"
                                    speaking={speakingIds.has(tile.id)}
                                />
                                <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[10px] text-white">
                                    {tile.name}
                                </span>
                            </button>
                        ))}
                    </div>
                    <p className="px-1 text-[11px] text-white/90">Нажмите, чтобы увеличить</p>
                </div>
            )}

            {mediaError && (
                <div className="absolute left-3 right-3 top-12 z-20 rounded-xl bg-tg-danger/90 px-3 py-2 text-center text-xs text-white">
                    {mediaError}
                </div>
            )}

            <div className="absolute inset-x-0 bottom-4 z-30 flex justify-center px-3">
                <div className="flex max-w-full items-center justify-center gap-2 overflow-x-auto rounded-full bg-tg-surface/95 px-3 py-2.5 shadow-xl sm:gap-2.5 sm:px-4">
                    <ControlButton
                        onClick={() => void toggleMute()}
                        danger={isMuted}
                        speaking={!isMuted && localSpeaking}
                        label={isMuted ? "Микрофон выкл." : "Микрофон"}
                    >
                        {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                    </ControlButton>

                    <ControlButton
                        onClick={() => void toggleCam()}
                        danger={isCamOff && !isSharing}
                        label={isCamOff ? "Камера выкл." : "Камера"}
                    >
                        {isCamOff ? <FaVideoSlash /> : <FaVideo />}
                    </ControlButton>

                    <ControlButton
                        onClick={() => void toggleScreenShare()}
                        danger={isSharing}
                        label={isSharing ? "Стоп экран" : "Демонстрация экрана"}
                    >
                        <FaDesktop />
                    </ControlButton>

                    <ControlButton
                        onClick={() => {
                            toggleRemoteSound();
                            unlockRemoteAudio();
                        }}
                        danger={remoteSoundOff}
                        label={remoteSoundOff ? "Включить звук" : "Выключить звук"}
                    >
                        {remoteSoundOff ? <FaVolumeMute /> : <FaVolumeUp />}
                    </ControlButton>

                    <ControlButton
                        onClick={toggleFullscreen}
                        label={isFullscreen ? "Свернуть" : "На весь экран"}
                    >
                        {isFullscreen ? <FaCompress /> : <FaExpand />}
                    </ControlButton>

                    {isOrganizer && (
                        <ControlButton onClick={onMuteAll} label="Выключить микрофоны у всех">
                            <FaMicrophoneSlash />
                        </ControlButton>
                    )}

                    <ControlButton onClick={onLeave} danger label="Выйти из встречи">
                        <FaPhoneSlash />
                    </ControlButton>
                </div>
            </div>
        </div>
    );
}

/** Always play every remote audio track — not only the stage tile. */
function RemoteAudioLayer({
    remotes,
    soundOff,
    onBlocked,
}: {
    remotes: PeerTileType[];
    soundOff: boolean;
    onBlocked: () => void;
}) {
    return (
        <div className="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden>
            {remotes.map((tile) => (
                <RemoteAudio
                    key={`${tile.id}-${tile.audioTrackId}`}
                    stream={tile.stream}
                    soundOff={soundOff}
                    onBlocked={onBlocked}
                />
            ))}
        </div>
    );
}

function RemoteAudio({
    stream,
    soundOff,
    onBlocked,
}: {
    stream: MediaStream | null;
    soundOff: boolean;
    onBlocked: () => void;
}) {
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !stream) return;

        const play = () => {
            audio.srcObject = stream;
            audio.muted = soundOff;
            audio.volume = soundOff ? 0 : 1;
            void audio.play().catch(() => onBlocked());
        };

        play();
        const onUnlock = () => play();
        stream.addEventListener("addtrack", play);
        stream.addEventListener("removetrack", play);
        window.addEventListener("meet-unlock-audio", onUnlock);
        return () => {
            stream.removeEventListener("addtrack", play);
            stream.removeEventListener("removetrack", play);
            window.removeEventListener("meet-unlock-audio", onUnlock);
        };
    }, [stream, soundOff, onBlocked]);

    return <audio ref={audioRef} autoPlay playsInline />;
}

function videoFitClass(tile: PeerTileType, variant: "stage" | "thumb"): string {
    if (tile.isSharing) return "object-contain";
    if (!tile.isLocal) return "object-contain";
    return variant === "thumb" ? "object-cover" : "object-cover";
}

function TileVideo({
    tile,
    variant,
    speaking,
}: {
    tile: PeerTileType;
    variant: "stage" | "thumb";
    speaking: boolean;
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        const video = videoRef.current;
        const stream = tile.stream;
        if (!video || !stream) return;

        const attachVideo = () => {
            video.srcObject = stream;
            video.muted = true;
            video.defaultMuted = true;
            video.playsInline = true;
            void video.play().catch(() => undefined);
        };

        attachVideo();
        stream.addEventListener("addtrack", attachVideo);
        stream.addEventListener("removetrack", attachVideo);
        return () => {
            stream.removeEventListener("addtrack", attachVideo);
            stream.removeEventListener("removetrack", attachVideo);
        };
    }, [tile.stream, tile.videoTrackId]);

    const waitingShare = tile.isSharing && !tile.videoEnabled;
    const showAvatar = (!tile.videoEnabled || !tile.stream) && !tile.isSharing;

    return (
        <div
            className={`relative h-full w-full bg-black ${
                speaking ? "ring-2 ring-inset ring-tg-online animate-pulse" : ""
            }`}
        >
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`h-full w-full bg-black ${videoFitClass(tile, variant)} ${
                    showAvatar ? "opacity-0" : "opacity-100"
                }`}
            />
            {waitingShare && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-2 text-center text-[11px] text-white/80">
                    Подключение экрана…
                </div>
            )}
            {showAvatar && (
                <div className="absolute inset-0 flex items-center justify-center bg-tg-surface-2">
                    <div
                        className={`flex items-center justify-center rounded-full bg-tg-bubble-out font-bold uppercase text-white ${
                            variant === "stage" ? "h-28 w-28 text-4xl" : "h-12 w-12 text-lg"
                        } ${speaking ? "ring-4 ring-tg-online" : ""}`}
                    >
                        {tile.name.replace(/\s*\(вы\)\s*/i, "").slice(0, 1) || "?"}
                    </div>
                </div>
            )}
        </div>
    );
}

function ControlButton({
    children,
    onClick,
    label,
    disabled,
    danger,
    speaking,
}: {
    children: ReactNode;
    onClick: () => void;
    label: string;
    disabled?: boolean;
    danger?: boolean;
    speaking?: boolean;
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-0 leading-none transition disabled:opacity-40 sm:h-12 sm:w-12 [&_svg]:block [&_svg]:h-[18px] [&_svg]:w-[18px] ${
                danger
                    ? "bg-tg-danger text-white hover:bg-tg-danger-hover"
                    : speaking
                      ? "animate-pulse bg-tg-online text-white ring-2 ring-tg-online/80"
                      : "bg-tg-surface-2 text-tg-text hover:bg-tg-panel"
            }`}
        >
            {children}
        </button>
    );
}
