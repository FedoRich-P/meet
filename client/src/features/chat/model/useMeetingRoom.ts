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

type RoomUserType = { id: string; name: string; room: string };

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
};

const FALLBACK_ICE: RTCConfiguration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
    ],
};

let iceConfigPromise: Promise<RTCConfiguration> | null = null;
const analyserHolders = new WeakMap<
    MediaStream,
    { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; trackId: string }
>();

async function loadIceConfig(): Promise<RTCConfiguration> {
    if (!iceConfigPromise) {
        iceConfigPromise = fetch("/api/ice")
            .then(async (res) => {
                if (!res.ok) return FALLBACK_ICE;
                const data = (await res.json()) as { iceServers?: RTCIceServer[] };
                if (!data.iceServers?.length) return FALLBACK_ICE;
                return { iceServers: data.iceServers };
            })
            .catch(() => FALLBACK_ICE);
    }
    return iceConfigPromise;
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
    const [connectionHint, setConnectionHint] = useState("Подключение…");
    const [speakingIds, setSpeakingIds] = useState<Set<string>>(() => new Set());
    const [localSpeaking, setLocalSpeaking] = useState(false);
    const iceConfigRef = useRef<RTCConfiguration>(FALLBACK_ICE);
    const analyseCtxRef = useRef<AudioContext | null>(null);

    useEffect(() => {
        localUserIdRef.current = localUserId;
    }, [localUserId]);

    useEffect(() => {
        void loadIceConfig().then((cfg) => {
            iceConfigRef.current = cfg;
        });
    }, []);

    useEffect(() => {
        let stopped = false;
        let raf = 0;

        const tick = () => {
            if (stopped) return;
            const next = new Set<string>();
            let localTalk = false;

            const measure = (id: string, stream: MediaStream | null, isLocal: boolean) => {
                if (!stream) return;
                const audioTracks = stream.getAudioTracks().filter((t) => t.enabled && t.readyState === "live");
                if (audioTracks.length === 0) return;
                try {
                    if (!analyseCtxRef.current) {
                        analyseCtxRef.current = new AudioContext();
                    }
                    const ctx = analyseCtxRef.current;
                    if (ctx.state === "suspended") void ctx.resume();
                    const trackId = audioTracks[0].id;
                    let holder = analyserHolders.get(stream);
                    if (!holder || holder.trackId !== trackId) {
                        const source = ctx.createMediaStreamSource(new MediaStream([audioTracks[0]]));
                        const analyser = ctx.createAnalyser();
                        analyser.fftSize = 256;
                        analyser.smoothingTimeConstant = 0.5;
                        source.connect(analyser);
                        holder = { source, analyser, trackId };
                        analyserHolders.set(stream, holder);
                    }
                    const data = new Uint8Array(holder.analyser.frequencyBinCount);
                    holder.analyser.getByteFrequencyData(data);
                    let sum = 0;
                    for (let i = 0; i < data.length; i += 1) sum += data[i];
                    const avg = sum / data.length;
                    if (avg > 18) {
                        next.add(id);
                        if (isLocal) localTalk = true;
                    }
                } catch {
                    // AudioContext / analyser unavailable
                }
            };

            const localId = localUserIdRef.current || "local";
            if (!isMutedRef.current) measure(localId, localStreamRef.current, true);
            for (const [id, stream] of remoteStreamsRef.current) {
                measure(id, stream, false);
            }

            setSpeakingIds((prev) => {
                if (prev.size === next.size && [...prev].every((id) => next.has(id))) return prev;
                return next;
            });
            setLocalSpeaking(localTalk);
            raf = window.setTimeout(tick, 120);
        };

        raf = window.setTimeout(tick, 120);
        return () => {
            stopped = true;
            window.clearTimeout(raf);
        };
    }, []);

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
                autoGainControl: false,
            },
            video: false,
        });

        localStreamRef.current = stream;
        for (const track of stream.getAudioTracks()) track.enabled = false;
        isMutedRef.current = true;
        setIsMuted(true);
        setIsCamOff(true);
        setHasLocalMedia(true);
        setMediaError(null);

        for (const { pc } of peersRef.current.values()) {
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
        publishTiles();
    }

    function createPeer(remoteId: string): PeerStateType {
        const existing = peersRef.current.get(remoteId);
        if (existing) return existing;

        const localId = localUserIdRef.current;
        const polite = localId > remoteId;
        const pc = new RTCPeerConnection(iceConfigRef.current);
        const state: PeerStateType = { pc, makingOffer: false, ignoreOffer: false, polite };
        peersRef.current.set(remoteId, state);

        const audioTx = pc.addTransceiver("audio", { direction: "sendrecv" });
        const videoTx = pc.addTransceiver("video", { direction: "sendrecv" });

        const local = localStreamRef.current;
        if (local) {
            const audioTrack = local.getAudioTracks()[0];
            const videoTrack = local.getVideoTracks()[0];
            if (audioTrack) void audioTx.sender.replaceTrack(audioTrack);
            if (videoTrack) void videoTx.sender.replaceTrack(videoTrack);
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("iceCandidate", { to: remoteId, candidate: event.candidate });
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
            if (pc.connectionState === "failed") {
                // restart ICE
                void pc.restartIce?.();
            }
            if (pc.connectionState === "closed") {
                closePeer(remoteId);
            }
        };

        pc.onnegotiationneeded = async () => {
            const me = localUserIdRef.current;
            if (!me || me === "pending") return;
            if (state.makingOffer || pc.signalingState !== "stable") return;
            try {
                state.makingOffer = true;
                await pc.setLocalDescription();
                socket.emit("callUser", {
                    userToCall: remoteId,
                    signal: pc.localDescription,
                    from: me,
                    name: localUserName,
                });
            } catch (err) {
                console.error("negotiationneeded", err);
            } finally {
                state.makingOffer = false;
            }
        };

        return state;
    }

    async function handleRemoteSignal(
        from: string,
        signal: RTCSessionDescriptionInit,
        name?: string
    ): Promise<void> {
        if (name) peerNamesRef.current.set(from, name);
        await ensureLocalStream();
        const state = createPeer(from);
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
        if (signal.type === "offer") {
            await pc.setLocalDescription();
            socket.emit("answerCall", { to: from, signal: pc.localDescription });
        }
        publishTiles();
    }

    async function syncPeers(users: RoomUserType[]): Promise<void> {
        const localId = localUserIdRef.current;
        if (!localId || localId === "pending") return;

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
            if (!remoteIds.has(id)) closePeer(id);
        }

        for (const id of remoteIds) {
            createPeer(id);
            // Impolite peer (smaller id) kicks negotiation by ensuring tracks are attached;
            // onnegotiationneeded will fire after addTrack.
            // If tracks already added before listener, manually offer:
            const state = peersRef.current.get(id);
            if (state && localId < id && state.pc.signalingState === "stable") {
                const senders = state.pc.getSenders();
                if (senders.length > 0 && !state.pc.remoteDescription) {
                    try {
                        state.makingOffer = true;
                        await state.pc.setLocalDescription();
                        socket.emit("callUser", {
                            userToCall: id,
                            signal: state.pc.localDescription,
                            from: localId,
                            name: localUserName,
                        });
                    } catch (err) {
                        console.error("manual offer", err);
                    } finally {
                        state.makingOffer = false;
                    }
                }
            }
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
            const state = peersRef.current.get(from);
            if (!state || !candidate) return;
            try {
                await state.pc.addIceCandidate(candidate);
            } catch {
                if (!state.ignoreOffer) {
                    // ignore
                }
            }
        };

        const onUsers = (users: RoomUserType[]) => {
            void syncPeers(users);
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

        return () => {
            socket.off("incomingCall", onIncoming);
            socket.off("callAccepted", onAccepted);
            socket.off("iceCandidate", onIce);
            socket.off("users", onUsers);
            socket.off("shareState", onShare);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket, localUserId, localUserName, roomId]);

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
            if (!nextMuted) window.dispatchEvent(new CustomEvent("meet-unlock-audio"));
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
    };
}
