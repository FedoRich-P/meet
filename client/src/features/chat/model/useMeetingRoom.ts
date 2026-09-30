import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "../../../shared";

export type PeerTileType = {
    id: string;
    name: string;
    stream: MediaStream | null;
    isLocal: boolean;
    isSharing: boolean;
    audioEnabled: boolean;
    videoEnabled: boolean;
    videoTrackId: string;
    audioTrackId: string;
    connection: string;
};

type RoomUserType = {
    id: string;
    name: string;
    room: string;
    online?: boolean;
    leftAt?: string | null;
};

type UseMeetingRoomResult = {
    tiles: PeerTileType[];
    stagePeerId: string | null;
    setStagePeerId: (id: string | null) => void;
    isMuted: boolean;
    isCamOff: boolean;
    isSharing: boolean;
    mediaError: string | null;
    hasLocalMedia: boolean;
    isFullscreen: boolean;
    connectionHint: string;
    speakingIds: Set<string>;
    localSpeaking: boolean;
    enableMedia: () => Promise<void>;
    toggleMute: () => Promise<void>;
    toggleCam: () => Promise<void>;
    toggleScreenShare: () => Promise<void>;
    toggleFullscreen: () => void;
    remoteSoundOff: boolean;
    toggleRemoteSound: () => void;
    speakerphone: boolean;
    toggleSpeakerphone: () => void;
};

const FALLBACK_ICE: RTCConfiguration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
    ],
    iceCandidatePoolSize: 4,
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
};

let iceConfigPromise: Promise<RTCConfiguration> | null = null;
const analyserHolders = new WeakMap<
    MediaStream,
    { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; trackId: string }
>();

function iceHasTurn(cfg: RTCConfiguration): boolean {
    return (cfg.iceServers ?? []).some((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url) => typeof url === "string" && url.startsWith("turn"));
    });
}

async function loadIceConfig(): Promise<RTCConfiguration> {
    if (!iceConfigPromise) {
        iceConfigPromise = fetch("/api/ice")
            .then(async (res) => {
                if (!res.ok) {
                    iceConfigPromise = null;
                    return FALLBACK_ICE;
                }
                const data = (await res.json()) as { iceServers?: RTCIceServer[] };
                if (!data.iceServers?.length) {
                    iceConfigPromise = null;
                    return FALLBACK_ICE;
                }
                const cfg: RTCConfiguration = {
                    iceServers: data.iceServers,
                    iceCandidatePoolSize: 8,
                    bundlePolicy: "max-bundle",
                    rtcpMuxPolicy: "require",
                    // Prefer "all": host/srflx for LAN/Wi‑Fi, TURN relay still in iceServers for hard NATs.
                    // Forcing "relay" hung forever on some mobile networks ("соединение…").
                    iceTransportPolicy: "all",
                };
                return cfg;
            })
            .catch(() => {
                iceConfigPromise = null;
                return FALLBACK_ICE;
            });
    }
    return iceConfigPromise;
}

function hasRemoteDescription(pc: RTCPeerConnection): boolean {
    return Boolean(pc.remoteDescription);
}

function connectionLabel(state: string): string {
    switch (state) {
        case "connected":
            return "на связи";
        case "connecting":
        case "checking":
            return "соединение…";
        case "disconnected":
            return "связь прервана";
        case "failed":
            return "не удалось подключиться";
        case "closed":
            return "завершено";
        default:
            return "подключение…";
    }
}

function trackLooksLikeScreen(track: MediaStreamTrack): boolean {
    const label = track.label.toLowerCase();
    if (label.includes("screen") || label.includes("window") || label.includes("tab") || label.includes("web-contents")) {
        return true;
    }
    return Boolean(track.getSettings().displaySurface);
}

function isIosDevice(): boolean {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function videoSender(pc: RTCPeerConnection): RTCRtpSender | undefined {
    return (
        pc.getSenders().find((sender) => sender.track?.kind === "video") ??
        pc.getTransceivers().find((transceiver) => transceiver.receiver.track?.kind === "video")?.sender
    );
}

function defaultCameraVideo(): MediaTrackConstraints {
    const phone = typeof window !== "undefined" && window.innerWidth < 768;
    return {
        facingMode: "user",
        width: { ideal: phone ? 640 : 960, max: 1280 },
        height: { ideal: phone ? 480 : 540, max: 720 },
        frameRate: { ideal: 24, max: 30 },
    };
}

async function applyVideoSenderEncoding(sender: RTCRtpSender, mode: "camera" | "screen"): Promise<void> {
    try {
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        if (mode === "screen") {
            params.encodings[0].maxBitrate = 2_500_000;
            params.encodings[0].maxFramerate = 15;
            params.degradationPreference = "maintain-resolution";
        } else {
            params.encodings[0].maxBitrate = 1_000_000;
            params.encodings[0].maxFramerate = 30;
            params.degradationPreference = "maintain-resolution";
        }
        await sender.setParameters(params);
    } catch {
        // older browsers
    }
}

function screenShareFailMessage(err: unknown): string {
    const name = err instanceof DOMException ? err.name : "";
    const iosChrome = /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    if (!window.isSecureContext) {
        return "Браузер блокирует показ экрана: сертификат страницы не доверенный.";
    }
    if (iosChrome || (isIosDevice() && (name === "NotSupportedError" || !navigator.mediaDevices?.getDisplayMedia))) {
        return "На iPhone показ экрана есть только в Safari. В Chrome на iPhone его нет.";
    }
    if (name === "NotSupportedError") return "Этот браузер не умеет показывать экран.";
    if (err instanceof Error && err.message) return err.message;
    return "Демонстрация не удалась";
}

type PeerStateType = {
    pc: RTCPeerConnection;
    makingOffer: boolean;
    ignoreOffer: boolean;
    polite: boolean;
    pendingIce: RTCIceCandidateInit[];
    iceRestartCount: number;
    restartingIce: boolean;
};

export function useMeetingRoom(
    localUserId: string,
    localUserName: string,
    roomId: string
): UseMeetingRoomResult {
    const socket = useSocket();

    const localStreamRef = useRef<MediaStream | null>(null);
    const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const peersRef = useRef<Map<string, PeerStateType>>(new Map());
    const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
    const peerNamesRef = useRef<Map<string, string>>(new Map());
    const peerConnRef = useRef<Map<string, string>>(new Map());
    const isSharingRef = useRef(false);
    const camWasOffRef = useRef(true);
    const peerSharingRef = useRef<Set<string>>(new Set());
    const localUserIdRef = useRef(localUserId);

    const [tiles, setTiles] = useState<PeerTileType[]>([]);
    const [stagePeerId, setStagePeerId] = useState<string | null>(null);
    const isMutedRef = useRef(true);
    const [isMuted, setIsMuted] = useState(true);
    const [isCamOff, setIsCamOff] = useState(true);
    const [isSharing, setIsSharing] = useState(false);
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [hasLocalMedia, setHasLocalMedia] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [remoteSoundOff, setRemoteSoundOff] = useState(false);
    const [speakerphone, setSpeakerphone] = useState(true);
    const [connectionHint, setConnectionHint] = useState("Подключение…");
    const [speakingIds, setSpeakingIds] = useState<Set<string>>(() => new Set());
    const [localSpeaking, setLocalSpeaking] = useState(false);
    const iceConfigRef = useRef<RTCConfiguration>(FALLBACK_ICE);
    const earlyIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
    const creatingPeersRef = useRef<Map<string, Promise<PeerStateType>>>(new Map());
    const recoverAttemptsRef = useRef<Map<string, number>>(new Map());
    const peerMissRef = useRef<Map<string, number>>(new Map());
    const analyseCtxRef = useRef<AudioContext | null>(null);

    useEffect(() => {
        localUserIdRef.current = localUserId;
    }, [localUserId]);

    useEffect(() => {
        void loadIceConfig().then((cfg) => {
            iceConfigRef.current = cfg;
            if (!iceHasTurn(cfg)) {
                console.warn("[meet] /api/ice returned no TURN — cross-network calls may fail");
            }
        });
    }, []);

    async function ensureIceConfig(): Promise<RTCConfiguration> {
        const cfg = await loadIceConfig();
        iceConfigRef.current = cfg;
        return cfg;
    }

    async function flushPendingIce(state: PeerStateType): Promise<void> {
        if (!hasRemoteDescription(state.pc) || state.pendingIce.length === 0) return;
        const queued = state.pendingIce.splice(0, state.pendingIce.length);
        for (const candidate of queued) {
            try {
                await state.pc.addIceCandidate(candidate);
            } catch (err) {
                console.warn("[meet] addIceCandidate (flush)", err);
            }
        }
    }

    async function queueRemoteIceCandidate(
        remoteId: string,
        candidate: RTCIceCandidateInit
    ): Promise<void> {
        const state = peersRef.current.get(remoteId);
        if (!state) {
            const early = earlyIceRef.current.get(remoteId) ?? [];
            early.push(candidate);
            earlyIceRef.current.set(remoteId, early);
            return;
        }
        if (!hasRemoteDescription(state.pc)) {
            state.pendingIce.push(candidate);
            return;
        }
        try {
            await state.pc.addIceCandidate(candidate);
        } catch (err) {
            console.warn("[meet] addIceCandidate", err);
        }
    }

    useEffect(() => {
        let stopped = false;
        let timer = 0;
        let lastEmittedSpeaking = false;
        const remoteSpeaking = new Map<string, boolean>();

        const resumeCtx = () => {
            try {
                if (!analyseCtxRef.current) {
                    analyseCtxRef.current = new AudioContext();
                }
                if (analyseCtxRef.current.state === "suspended") {
                    void analyseCtxRef.current.resume();
                }
            } catch {
                // ignore
            }
        };
        window.addEventListener("meet-unlock-audio", resumeCtx);
        window.addEventListener("pointerdown", resumeCtx);

        const onRemoteSpeaking = ({ from, speaking }: { from: string; speaking: boolean }) => {
            remoteSpeaking.set(from, speaking);
            // Peer visible via socket speaking but missing from WebRTC map → refresh roster
            if (
                speaking &&
                from &&
                from !== localUserIdRef.current &&
                !peersRef.current.has(from)
            ) {
                socket.emit("getUsers", roomId);
            }
        };
        socket.on("speaking", onRemoteSpeaking);

        async function levelFromSenderStats(): Promise<number> {
            let best = 0;
            for (const { pc } of peersRef.current.values()) {
                const sender = pc.getSenders().find((s) => s.track?.kind === "audio" && s.track);
                if (!sender) continue;
                try {
                    const stats = await sender.getStats();
                    for (const report of stats.values()) {
                        const level =
                            typeof (report as { audioLevel?: number }).audioLevel === "number"
                                ? (report as { audioLevel: number }).audioLevel
                                : undefined;
                        if (typeof level === "number" && level > best) best = level;
                    }
                } catch {
                    // ignore
                }
            }
            return best;
        }

        function levelFromAnalyser(): number {
            const stream = localStreamRef.current;
            if (!stream) return 0;
            const audioTracks = stream.getAudioTracks().filter((t) => t.enabled && t.readyState === "live");
            if (audioTracks.length === 0) return 0;
            try {
                resumeCtx();
                const ctx = analyseCtxRef.current;
                if (!ctx) return 0;
                const trackId = audioTracks[0].id;
                let holder = analyserHolders.get(stream);
                if (!holder || holder.trackId !== trackId) {
                    const source = ctx.createMediaStreamSource(stream);
                    const analyser = ctx.createAnalyser();
                    analyser.fftSize = 1024;
                    analyser.smoothingTimeConstant = 0.2;
                    source.connect(analyser);
                    holder = { source, analyser, trackId };
                    analyserHolders.set(stream, holder);
                }
                const data = new Uint8Array(holder.analyser.fftSize);
                holder.analyser.getByteTimeDomainData(data);
                let sum = 0;
                for (let i = 0; i < data.length; i += 1) {
                    const v = (data[i] - 128) / 128;
                    sum += v * v;
                }
                return Math.sqrt(sum / data.length);
            } catch {
                return 0;
            }
        }

        const loop = () => {
            if (stopped) return;
            void (async () => {
                if (isMutedRef.current) {
                    setLocalSpeaking(false);
                    if (lastEmittedSpeaking) {
                        lastEmittedSpeaking = false;
                        socket.emit("speaking", { room: roomId, speaking: false });
                    }
                    const next = new Set<string>();
                    for (const [id, speaking] of remoteSpeaking) {
                        if (speaking) next.add(id);
                    }
                    setSpeakingIds((prev) => {
                        if (prev.size === next.size && [...prev].every((id) => next.has(id))) return prev;
                        return next;
                    });
                    return;
                }

                let level = levelFromAnalyser();
                if (level < 0.015) {
                    const statsLevel = await levelFromSenderStats();
                    if (statsLevel > level) level = statsLevel;
                }
                // Desktop mics + AEC often report lower RMS — keep threshold low
                const localTalk = level > 0.015;
                setLocalSpeaking(localTalk);
                if (localTalk !== lastEmittedSpeaking) {
                    lastEmittedSpeaking = localTalk;
                    socket.emit("speaking", { room: roomId, speaking: localTalk });
                }
                const next = new Set<string>();
                const localId = localUserIdRef.current || "local";
                if (localTalk) next.add(localId);
                for (const [id, speaking] of remoteSpeaking) {
                    if (speaking) next.add(id);
                }
                setSpeakingIds((prev) => {
                    if (prev.size === next.size && [...prev].every((id) => next.has(id))) return prev;
                    return next;
                });
            })().finally(() => {
                if (!stopped) timer = window.setTimeout(loop, 100);
            });
        };

        loop();
        return () => {
            stopped = true;
            window.clearTimeout(timer);
            window.removeEventListener("meet-unlock-audio", resumeCtx);
            window.removeEventListener("pointerdown", resumeCtx);
            socket.off("speaking", onRemoteSpeaking);
            if (lastEmittedSpeaking) {
                socket.emit("speaking", { room: roomId, speaking: false });
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket, roomId]);

    const publishTiles = useCallback(() => {
        const next: PeerTileType[] = [];
        const local = localStreamRef.current;
        const localId = localUserIdRef.current || "local";

        next.push({
            id: localId,
            name: `${localUserName || "Вы"} (вы)`,
            stream: local,
            isLocal: true,
            isSharing: isSharingRef.current,
            audioEnabled: Boolean(local?.getAudioTracks().some((t) => t.enabled)),
            videoEnabled: Boolean(local?.getVideoTracks().some((t) => t.enabled && t.readyState === "live")),
            videoTrackId: local?.getVideoTracks()[0]?.id ?? "",
            audioTrackId: local?.getAudioTracks()[0]?.id ?? "",
            connection: "local",
        });

        for (const [id, stream] of remoteStreamsRef.current) {
            const videoTracks = stream.getVideoTracks();
            const sharing = peerSharingRef.current.has(id) || videoTracks.some(trackLooksLikeScreen);
            next.push({
                id,
                name: peerNamesRef.current.get(id) || "Участник",
                stream,
                isLocal: false,
                isSharing: sharing,
                audioEnabled: stream.getAudioTracks().some((t) => t.enabled && t.readyState === "live"),
                videoEnabled: sharing
                    ? videoTracks.some((t) => t.readyState === "live")
                    : videoTracks.some((t) => t.enabled && t.readyState === "live"),
                videoTrackId: videoTracks[0]?.id ?? "",
                audioTrackId: stream.getAudioTracks()[0]?.id ?? "",
                connection: connectionLabel(peerConnRef.current.get(id) || "new"),
            });
        }

        setTiles(next);

        const remotes = next.filter((t) => !t.isLocal);
        if (remotes.length === 0) {
            setConnectionHint("Ждём участников…");
        } else if (remotes.every((t) => t.connection === "на связи")) {
            setConnectionHint(`На связи: ${remotes.length}`);
        } else {
            setConnectionHint(
                remotes.map((t) => `${t.name}: ${t.connection}`).join(", ")
            );
        }
    }, [localUserName]);

    async function ensureLocalStream(): Promise<MediaStream> {
        if (localStreamRef.current) return localStreamRef.current;
        if (!window.isSecureContext) {
            throw new Error("Браузер не даёт микрофон: откройте встречу по https://");
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("Браузер не даёт микрофон");
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
            video: false,
        });

        localStreamRef.current = stream;
        // Start with mic on so cross-network tests aren't "silent while connected"
        for (const track of stream.getAudioTracks()) track.enabled = true;
        isMutedRef.current = false;
        setIsMuted(false);
        setIsCamOff(true);
        setHasLocalMedia(true);
        setMediaError(null);

        for (const [remoteId, state] of peersRef.current.entries()) {
            const { pc } = state;
            for (const track of stream.getTracks()) {
                const sender =
                    pc.getSenders().find((s) => s.track?.kind === track.kind) ??
                    pc.getTransceivers().find((t) => t.receiver.track.kind === track.kind)?.sender;
                if (sender) {
                    void sender.replaceTrack(track);
                } else {
                    pc.addTrack(track, stream);
                }
            }
            // Renegotiate so the remote actually gets ontrack for late-attached media
            if (!state.polite && pc.signalingState === "stable" && pc.remoteDescription) {
                void offerToPeer(remoteId, state, false);
            }
        }

        publishTiles();
        return stream;
    }

    const enableMedia = useCallback(async () => {
        try {
            await ensureLocalStream();
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Нет доступа к камере/микрофону";
            setMediaError(msg);
            throw err;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [publishTiles]);

    function closePeer(id: string): void {
        peersRef.current.get(id)?.pc.close();
        peersRef.current.delete(id);
        remoteStreamsRef.current.delete(id);
        peerConnRef.current.delete(id);
        earlyIceRef.current.delete(id);
        creatingPeersRef.current.delete(id);
        publishTiles();
    }

    async function offerToPeer(remoteId: string, state: PeerStateType, iceRestart = false): Promise<void> {
        const me = localUserIdRef.current;
        if (!me || me === "pending") return;
        if (state.makingOffer) return;
        if (state.pc.signalingState === "closed") return;
        try {
            state.makingOffer = true;
            const offer = iceRestart
                ? await state.pc.createOffer({ iceRestart: true })
                : await state.pc.createOffer();
            await state.pc.setLocalDescription(offer);
            socket.emit("callUser", {
                userToCall: remoteId,
                signal: state.pc.localDescription,
                from: me,
                name: localUserName,
            });
        } catch (err) {
            console.error("[meet] offerToPeer", err);
        } finally {
            state.makingOffer = false;
        }
    }

    async function restartIceForPeer(remoteId: string, state: PeerStateType): Promise<void> {
        const me = localUserIdRef.current;
        if (!me || me === "pending") return;
        if (peersRef.current.get(remoteId)?.pc !== state.pc) return;
        if (state.restartingIce || state.makingOffer) return;
        if (state.pc.signalingState === "closed") return;

        // Polite peer: after prolonged fail, rebuild PC and wait for offer
        if (state.polite) {
            state.iceRestartCount += 1;
            if (state.iceRestartCount <= 2) return;
            state.restartingIce = true;
            try {
                const attempts = (recoverAttemptsRef.current.get(remoteId) ?? 0) + 1;
                recoverAttemptsRef.current.set(remoteId, attempts);
                if (attempts > 5) return;
                closePeer(remoteId);
                await createPeer(remoteId);
            } finally {
                state.restartingIce = false;
            }
            return;
        }

        state.restartingIce = true;
        state.iceRestartCount += 1;
        try {
            await new Promise((resolve) => window.setTimeout(resolve, 500 * state.iceRestartCount));
            if (
                state.pc.connectionState === "connected" ||
                state.pc.iceConnectionState === "connected" ||
                state.pc.iceConnectionState === "completed"
            ) {
                return;
            }

            if (state.iceRestartCount > 2) {
                const attempts = (recoverAttemptsRef.current.get(remoteId) ?? 0) + 1;
                recoverAttemptsRef.current.set(remoteId, attempts);
                if (attempts > 5) {
                    console.warn("[meet] giving up ICE recover for", remoteId);
                    return;
                }
                closePeer(remoteId);
                if (attempts >= 2 && iceConfigRef.current.iceTransportPolicy === "relay") {
                    iceConfigRef.current = {
                        ...iceConfigRef.current,
                        iceTransportPolicy: "all",
                    };
                }
                const next = await createPeer(remoteId);
                if (!next.polite) await offerToPeer(remoteId, next, false);
                return;
            }

            await ensureIceConfig();
            try {
                state.pc.setConfiguration(iceConfigRef.current);
            } catch {
                // ignore
            }
            await offerToPeer(remoteId, state, true);
        } catch (err) {
            console.error("[meet] ICE restart failed", err);
        } finally {
            state.restartingIce = false;
        }
    }

    function attachLocalMedia(pc: RTCPeerConnection): void {
        const local = localStreamRef.current;
        const audioTrack = local?.getAudioTracks()[0];
        const videoTrack = local?.getVideoTracks()[0];

        const audioSender =
            pc.getSenders().find((s) => s.track?.kind === "audio") ??
            pc.getTransceivers().find((t) => t.receiver.track.kind === "audio")?.sender;
        const videoSenderExisting =
            pc.getSenders().find((s) => s.track?.kind === "video") ??
            pc.getTransceivers().find((t) => t.receiver.track.kind === "video")?.sender;

        if (audioTrack) {
            if (audioSender) void audioSender.replaceTrack(audioTrack);
            else pc.addTrack(audioTrack, local!);
        } else if (!pc.getTransceivers().some((t) => t.receiver.track.kind === "audio")) {
            pc.addTransceiver("audio", { direction: "recvonly" });
        }

        if (videoTrack) {
            if (videoSenderExisting) void videoSenderExisting.replaceTrack(videoTrack);
            else pc.addTrack(videoTrack, local!);
        } else if (!pc.getTransceivers().some((t) => t.receiver.track.kind === "video")) {
            pc.addTransceiver("video", { direction: "recvonly" });
        }
    }

    async function createPeer(remoteId: string, options?: { asAnswerer?: boolean }): Promise<PeerStateType> {
        const existing = peersRef.current.get(remoteId);
        if (existing) return existing;

        const inflight = creatingPeersRef.current.get(remoteId);
        if (inflight) return inflight;

        const build = (async (): Promise<PeerStateType> => {
            await ensureIceConfig();

            const again = peersRef.current.get(remoteId);
            if (again) return again;

            const localId = localUserIdRef.current;
            const polite = localId > remoteId;
            const pc = new RTCPeerConnection(iceConfigRef.current);
            const state: PeerStateType = {
                pc,
                makingOffer: false,
                ignoreOffer: false,
                polite,
                pendingIce: [],
                iceRestartCount: 0,
                restartingIce: false,
            };
            peersRef.current.set(remoteId, state);

            const early = earlyIceRef.current.get(remoteId);
            if (early?.length) {
                state.pendingIce.push(...early);
                earlyIceRef.current.delete(remoteId);
            }

            // Offer side: attach media before createOffer.
            // Answer side: wait until after setRemoteDescription (attach in handleRemoteSignal).
            if (!options?.asAnswerer) {
                attachLocalMedia(pc);
            }

            pc.onicecandidate = (event) => {
                if (!event.candidate) return;
                const payload =
                    typeof event.candidate.toJSON === "function"
                        ? event.candidate.toJSON()
                        : event.candidate;
                socket.emit("iceCandidate", { to: remoteId, candidate: payload });
            };

            pc.onicegatheringstatechange = () => {
                if (pc.iceGatheringState === "complete") {
                    publishTiles();
                }
            };

            pc.oniceconnectionstatechange = () => {
                const iceState = pc.iceConnectionState;
                if (iceState === "failed") {
                    peerConnRef.current.set(remoteId, "failed");
                    publishTiles();
                    void restartIceForPeer(remoteId, state);
                } else if (iceState === "disconnected") {
                    peerConnRef.current.set(remoteId, "disconnected");
                    publishTiles();
                    window.setTimeout(() => {
                        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
                            void restartIceForPeer(remoteId, state);
                        }
                    }, 2500);
                } else if (iceState === "connected" || iceState === "completed") {
                    state.iceRestartCount = 0;
                    recoverAttemptsRef.current.delete(remoteId);
                    peerConnRef.current.set(remoteId, "connected");
                    publishTiles();
                }
            };

            pc.ontrack = (event) => {
                let stream = remoteStreamsRef.current.get(remoteId);
                if (!stream) {
                    stream = new MediaStream();
                    remoteStreamsRef.current.set(remoteId, stream);
                }
                const incoming = event.track;
                if (incoming) {
                    if (incoming.kind === "video") {
                        for (const existingTrack of stream.getVideoTracks()) {
                            if (existingTrack.id !== incoming.id) stream.removeTrack(existingTrack);
                        }
                    }
                    if (incoming.kind === "audio") {
                        for (const existingTrack of stream.getAudioTracks()) {
                            if (existingTrack.id !== incoming.id) stream.removeTrack(existingTrack);
                        }
                    }
                    if (!stream.getTrackById(incoming.id)) stream.addTrack(incoming);
                    incoming.enabled = true;
                    incoming.onunmute = () => publishTiles();
                    incoming.onmute = () => publishTiles();
                    incoming.onended = () => {
                        if (stream.getTrackById(incoming.id)) stream.removeTrack(incoming);
                        publishTiles();
                    };
                    if (
                        incoming.kind === "video" &&
                        (peerSharingRef.current.has(remoteId) || trackLooksLikeScreen(incoming))
                    ) {
                        setStagePeerId(remoteId);
                    }
                }
                publishTiles();
                window.dispatchEvent(new CustomEvent("meet-unlock-audio"));
            };

            pc.onconnectionstatechange = () => {
                peerConnRef.current.set(remoteId, pc.connectionState);
                publishTiles();
                if (pc.connectionState === "connected") {
                    state.iceRestartCount = 0;
                    recoverAttemptsRef.current.delete(remoteId);
                    attachLocalMedia(pc);
                    window.dispatchEvent(new CustomEvent("meet-unlock-audio"));
                    const remote = remoteStreamsRef.current.get(remoteId);
                    const hasRemoteAudio = Boolean(remote?.getAudioTracks().length);
                    if (!hasRemoteAudio && !state.polite && pc.signalingState === "stable") {
                        void offerToPeer(remoteId, state, false);
                    }
                }
                if (pc.connectionState === "failed") {
                    void restartIceForPeer(remoteId, state);
                }
                if (pc.connectionState === "closed") {
                    closePeer(remoteId);
                }
            };

            pc.onnegotiationneeded = async () => {
                const me = localUserIdRef.current;
                if (!me || me === "pending") return;
                if (state.makingOffer || pc.signalingState !== "stable") return;
                if (state.polite) return;
                await offerToPeer(remoteId, state, false);
            };

            // If ICE hangs on "connecting" (common on cellular), recover
            window.setTimeout(() => {
                if (peersRef.current.get(remoteId)?.pc !== pc) return;
                const cs = pc.connectionState;
                const ice = pc.iceConnectionState;
                if (cs === "connected" || ice === "connected" || ice === "completed") return;
                if (cs === "closed" || cs === "failed") return;
                console.warn("[meet] ICE still not connected after 8s", remoteId, cs, ice);
                void restartIceForPeer(remoteId, state);
            }, 8000);

            return state;
        })();

        creatingPeersRef.current.set(remoteId, build);
        try {
            return await build;
        } finally {
            creatingPeersRef.current.delete(remoteId);
        }
    }

    async function handleRemoteSignal(
        from: string,
        signal: RTCSessionDescriptionInit,
        name?: string
    ): Promise<void> {
        if (name) peerNamesRef.current.set(from, name);
        await ensureLocalStream();
        const asAnswerer = signal.type === "offer";
        const state = await createPeer(from, { asAnswerer });
        const { pc, polite } = state;

        const offerCollision =
            signal.type === "offer" && (state.makingOffer || pc.signalingState !== "stable");

        if (offerCollision) {
            if (!polite) return;
            try {
                await pc.setLocalDescription({ type: "rollback" });
            } catch {
                return;
            }
        }

        await pc.setRemoteDescription(signal);
        await flushPendingIce(state);
        if (signal.type === "offer") {
            attachLocalMedia(pc);
            await pc.setLocalDescription();
            socket.emit("answerCall", { to: from, signal: pc.localDescription });
        }
        publishTiles();
    }

    async function syncPeers(users: RoomUserType[]): Promise<void> {
        const localId = localUserIdRef.current;
        if (!localId || localId === "pending") return;

        await ensureIceConfig();

        try {
            await ensureLocalStream();
        } catch (err) {
            console.warn("media not ready yet", err);
        }

        for (const u of users) {
            peerNamesRef.current.set(u.id, u.name);
        }

        const remoteIds = new Set(users.map((u) => u.id).filter((id) => id !== localId));

        for (const id of [...peersRef.current.keys()]) {
            if (!remoteIds.has(id)) {
                // Stale/partial roster must not wipe live peers (caused remotes:[])
                const misses = (peerMissRef.current.get(id) ?? 0) + 1;
                peerMissRef.current.set(id, misses);
                if (misses >= 3) {
                    peerMissRef.current.delete(id);
                    closePeer(id);
                }
            } else {
                peerMissRef.current.delete(id);
            }
        }

        for (const id of remoteIds) {
            const state = await createPeer(id);
            // Impolite peer (smaller id) kicks negotiation
            if (localId < id && state.pc.signalingState === "stable") {
                const senders = state.pc.getSenders();
                if (senders.length > 0 && !state.pc.remoteDescription) {
                    await offerToPeer(id, state, false);
                }
            }
            // If stuck without remote SDP, retry offer shortly
            window.setTimeout(() => {
                const cur = peersRef.current.get(id);
                if (!cur || cur.pc !== state.pc) return;
                if (cur.pc.remoteDescription) return;
                if (cur.polite) {
                    socket.emit("getUsers", roomId);
                    return;
                }
                if (cur.pc.signalingState === "stable") {
                    void offerToPeer(id, cur, false);
                }
            }, 2000);
        }
        publishTiles();
    }

    useEffect(() => {
        if (!localUserId || localUserId === "pending" || !roomId) return;

        const onIncoming = async ({
            from,
            signal,
            name,
        }: {
            from: string;
            signal: RTCSessionDescriptionInit;
            name?: string;
        }) => {
            try {
                await handleRemoteSignal(from, signal, name);
            } catch (err) {
                console.error("incomingCall", err);
            }
        };

        const onAccepted = async ({ from, signal }: { from: string; signal: RTCSessionDescriptionInit }) => {
            try {
                await handleRemoteSignal(from, signal);
            } catch (err) {
                console.error("callAccepted", err);
            }
        };

        const onIce = async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
            if (!candidate) return;
            await queueRemoteIceCandidate(from, candidate);
        };

        const onUsers = (users: RoomUserType[]) => {
            void syncPeers(users.filter((u) => u.online !== false && !u.leftAt));
        };

        const onShare = ({ from, sharing }: { from: string; sharing: boolean }) => {
            if (sharing) peerSharingRef.current.add(from);
            else {
                peerSharingRef.current.delete(from);
                setStagePeerId((prev) => (prev === from ? null : prev));
                const remote = remoteStreamsRef.current.get(from);
                if (remote) {
                    for (const vt of [...remote.getVideoTracks()]) {
                        remote.removeTrack(vt);
                    }
                }
            }
            if (sharing) setStagePeerId(from);
            publishTiles();
            if (!sharing) window.dispatchEvent(new CustomEvent("meet-unlock-audio"));
        };

        socket.on("incomingCall", onIncoming);
        socket.on("callAccepted", onAccepted);
        socket.on("iceCandidate", onIce);
        socket.on("users", onUsers);
        socket.on("shareState", onShare);

        // pull current roster now that we have a real socket id
        socket.emit("getUsers", roomId);
        const retryA = window.setTimeout(() => socket.emit("getUsers", roomId), 800);
        const retryB = window.setTimeout(() => socket.emit("getUsers", roomId), 2500);
        const rosterPoll = window.setInterval(() => {
            const alone = peersRef.current.size === 0;
            const stuck = [...peersRef.current.values()].some(
                (s) =>
                    s.pc.connectionState !== "connected" &&
                    s.pc.connectionState !== "closed"
            );
            if (alone || stuck) socket.emit("getUsers", roomId);
        }, 4000);

        return () => {
            window.clearTimeout(retryA);
            window.clearTimeout(retryB);
            window.clearInterval(rosterPoll);
            socket.off("incomingCall", onIncoming);
            socket.off("callAccepted", onAccepted);
            socket.off("iceCandidate", onIce);
            socket.off("users", onUsers);
            socket.off("shareState", onShare);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket, localUserId, localUserName, roomId]);

    useEffect(() => {
        const dump = () => {
            const peers = [...peersRef.current.entries()].map(([id, state]) => ({
                id,
                name: peerNamesRef.current.get(id),
                connection: state.pc.connectionState,
                ice: state.pc.iceConnectionState,
                signaling: state.pc.signalingState,
                polite: state.polite,
                pendingIce: state.pendingIce.length,
                remoteAudio: remoteStreamsRef.current.get(id)?.getAudioTracks().length ?? 0,
                remoteVideo: remoteStreamsRef.current.get(id)?.getVideoTracks().length ?? 0,
                localSendAudio: state.pc.getSenders().some((s) => s.track?.kind === "audio" && s.track.readyState === "live"),
            }));
            return {
                localUserId: localUserIdRef.current,
                iceHasTurn: iceHasTurn(iceConfigRef.current),
                icePolicy: iceConfigRef.current.iceTransportPolicy ?? "all",
                muted: isMutedRef.current,
                localAudio: localStreamRef.current?.getAudioTracks().map((t) => ({
                    id: t.id,
                    enabled: t.enabled,
                    readyState: t.readyState,
                })),
                peers,
                hint: connectionHint,
            };
        };
        (window as unknown as { __meetDebug?: () => unknown }).__meetDebug = dump;
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "m") {
                console.info("[meet debug]", dump());
            }
        };
        window.addEventListener("keydown", onKey);
        const syncTimer = window.setInterval(() => {
            if (peersRef.current.size > 0) publishTiles();
        }, 1500);
        return () => {
            window.clearInterval(syncTimer);
            window.removeEventListener("keydown", onKey);
            delete (window as unknown as { __meetDebug?: () => unknown }).__meetDebug;
        };
    }, [connectionHint, publishTiles]);

    useEffect(() => {
        return () => {
            for (const id of [...peersRef.current.keys()]) closePeer(id);
            screenStreamRef.current?.getTracks().forEach((t) => t.stop());
            localStreamRef.current?.getTracks().forEach((t) => t.stop());
            localStreamRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const applyMute = (muted: boolean) => {
        const tracks = localStreamRef.current?.getAudioTracks() ?? [];
        if (tracks.length === 0) return false;
        for (const track of tracks) track.enabled = !muted;
        isMutedRef.current = muted;
        setIsMuted(muted);
        publishTiles();
        return true;
    };

    const toggleMute = async () => {
        try {
            const stream = await ensureLocalStream();
            if (stream.getAudioTracks().length === 0) {
                setMediaError("Микрофон не найден");
                return;
            }
            const nextMuted = !isMutedRef.current;
            applyMute(nextMuted);
            if (!nextMuted) {
                try {
                    if (!analyseCtxRef.current) analyseCtxRef.current = new AudioContext();
                    void analyseCtxRef.current.resume();
                } catch {
                    // ignore
                }
                window.dispatchEvent(new CustomEvent("meet-unlock-audio"));
            } else {
                socket.emit("speaking", { room: roomId, speaking: false });
                setLocalSpeaking(false);
            }
            setMediaError(null);
        } catch (err) {
            setMediaError(err instanceof Error ? err.message : "Микрофон недоступен");
        }
    };

    useEffect(() => {
        const onForceMute = ({ from, room }: { from: string; room: string }) => {
            if (room !== roomId) return;
            if (from === localUserIdRef.current) return;
            if (!localStreamRef.current) return;
            applyMute(true);
            setMediaError("Организатор выключил ваш микрофон");
        };
        socket.on("forceMute", onForceMute);
        return () => {
            socket.off("forceMute", onForceMute);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket, roomId]);

    const toggleCam = async () => {
        if (isSharingRef.current) {
            setMediaError("Сначала остановите демонстрацию экрана");
            return;
        }
        try {
            let stream = localStreamRef.current;
            let videoTrack =
                stream?.getVideoTracks().find((t) => t.readyState === "live") ??
                cameraTrackRef.current;
            let justAcquired = false;

            if (!stream) {
                stream = await ensureLocalStream();
                videoTrack = stream.getVideoTracks()[0] ?? null;
            }

            if (!videoTrack || videoTrack.readyState === "ended") {
                const camOnly = await navigator.mediaDevices.getUserMedia({
                    video: defaultCameraVideo(),
                    audio: false,
                });
                videoTrack = camOnly.getVideoTracks()[0] ?? null;
                if (!videoTrack) {
                    setMediaError("Камера не найдена");
                    return;
                }
                cameraTrackRef.current = videoTrack;
                justAcquired = true;
                if (!stream.getVideoTracks().includes(videoTrack)) {
                    stream.addTrack(videoTrack);
                }
                for (const { pc } of peersRef.current.values()) {
                    const sender = videoSender(pc);
                    if (sender) {
                        await sender.replaceTrack(videoTrack);
                        await applyVideoSenderEncoding(sender, "camera");
                    } else pc.addTrack(videoTrack, stream);
                }
                setHasLocalMedia(true);
            }

            if (!videoTrack) {
                setMediaError("Камера не найдена");
                return;
            }

            if (!justAcquired && videoTrack.enabled) {
                videoTrack.enabled = false;
                videoTrack.stop();
                if (stream.getVideoTracks().includes(videoTrack)) stream.removeTrack(videoTrack);
                if (cameraTrackRef.current === videoTrack) cameraTrackRef.current = null;
                for (const { pc } of peersRef.current.values()) {
                    const sender = videoSender(pc);
                    if (sender) await sender.replaceTrack(null);
                }
                camWasOffRef.current = true;
                setIsCamOff(true);
            } else {
                videoTrack.enabled = true;
                if (!stream.getVideoTracks().includes(videoTrack)) stream.addTrack(videoTrack);
                for (const { pc } of peersRef.current.values()) {
                    const sender = videoSender(pc);
                    if (sender) {
                        await sender.replaceTrack(videoTrack);
                        await applyVideoSenderEncoding(sender, "camera");
                    } else pc.addTrack(videoTrack, stream);
                }
                camWasOffRef.current = false;
                setIsCamOff(false);
            }
            setMediaError(null);
            publishTiles();
        } catch (err) {
            setMediaError(err instanceof Error ? err.message : "Камера недоступна");
        }
    };

    async function restoreCamera(): Promise<void> {
        screenStreamRef.current?.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
        const cam = cameraTrackRef.current;
        const local = localStreamRef.current;
        const turnCamOn = Boolean(cam && cam.readyState === "live" && !camWasOffRef.current);
        if (local) {
            local.getVideoTracks().forEach((t) => {
                if (t !== cam) {
                    local.removeTrack(t);
                    t.stop();
                }
            });
            if (cam && turnCamOn) {
                if (!local.getVideoTracks().includes(cam)) local.addTrack(cam);
                cam.enabled = true;
            } else if (cam) {
                if (local.getVideoTracks().includes(cam)) local.removeTrack(cam);
                cam.stop();
                cameraTrackRef.current = null;
            }
            for (const { pc } of peersRef.current.values()) {
                const sender = videoSender(pc);
                if (sender) {
                    await sender.replaceTrack(turnCamOn && cam ? cam : null);
                    if (turnCamOn && cam) await applyVideoSenderEncoding(sender, "camera");
                }
            }
        }
        isSharingRef.current = false;
        setIsSharing(false);
        setIsCamOff(!turnCamOn);
        socket.emit("shareState", { room: roomId, sharing: false });
        publishTiles();
    }

    const toggleScreenShare = async () => {
        let screen: MediaStream | null = null;
        try {
            if (isSharingRef.current) {
                await restoreCamera();
                return;
            }
            if (!navigator.mediaDevices?.getDisplayMedia || !window.isSecureContext) {
                setMediaError(screenShareFailMessage(new DOMException("", "NotSupportedError")));
                return;
            }

            // Must start immediately, before other awaits, or the phone drops the tap.
            screen = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false,
            });
            const screenTrack = screen.getVideoTracks()[0];
            if (!screenTrack) return;
            screenTrack.contentHint = "detail";
            try {
                await screenTrack.applyConstraints({
                    frameRate: { ideal: 12, max: 15 },
                    width: { max: 1920 },
                    height: { max: 1080 },
                });
            } catch {
                // phone may ignore size limits
            }

            await ensureLocalStream();
            screenStreamRef.current = screen;
            const local = localStreamRef.current!;
            const cam = local.getVideoTracks()[0] ?? cameraTrackRef.current;
            camWasOffRef.current = !cam || cam.readyState !== "live" || !cam.enabled;
            if (cam && cam !== screenTrack) {
                cameraTrackRef.current = cam;
                local.removeTrack(cam);
            }
            if (!local.getVideoTracks().includes(screenTrack)) local.addTrack(screenTrack);

            for (const { pc } of peersRef.current.values()) {
                const sender = videoSender(pc);
                if (sender) {
                    await sender.replaceTrack(screenTrack);
                    await applyVideoSenderEncoding(sender, "screen");
                } else {
                    pc.addTrack(screenTrack, local);
                }
            }

            isSharingRef.current = true;
            setIsSharing(true);
            setStagePeerId(localUserIdRef.current || "local");
            socket.emit("shareState", { room: roomId, sharing: true });
            publishTiles();

            screenTrack.onended = () => {
                void restoreCamera();
            };
        } catch (err) {
            screen?.getTracks().forEach((track) => track.stop());
            if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")) return;
            setMediaError(screenShareFailMessage(err));
        }
    };

    const toggleRemoteSound = () => {
        setRemoteSoundOff((prev) => {
            const next = !prev;
            if (!next) window.dispatchEvent(new CustomEvent("meet-unlock-audio"));
            return next;
        });
    };

    const toggleSpeakerphone = () => {
        setSpeakerphone((prev) => {
            const next = !prev;
            window.dispatchEvent(
                new CustomEvent("meet-speakerphone", { detail: { speakerphone: next } })
            );
            window.dispatchEvent(new CustomEvent("meet-unlock-audio"));
            return next;
        });
    };

    const toggleFullscreen = () => {
        const el = document.getElementById("meet-stage");
        if (!el) return;
        if (!document.fullscreenElement) {
            void el.requestFullscreen?.().then(() => setIsFullscreen(true));
        } else {
            void document.exitFullscreen?.().then(() => setIsFullscreen(false));
        }
    };

    useEffect(() => {
        const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener("fullscreenchange", onFs);
        return () => document.removeEventListener("fullscreenchange", onFs);
    }, []);

    return {
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
        speakerphone,
        toggleSpeakerphone,
    };
}
