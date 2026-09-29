import { useEffect, useRef, useState, type RefObject } from "react";
import { useSocket } from "../../../shared";

type IncomingCallType = {
    from: string;
    signal: RTCSessionDescriptionInit;
    name?: string;
};

type UseWebRTCResult = {
    localVideo: RefObject<HTMLVideoElement | null>;
    remoteVideo: RefObject<HTMLVideoElement | null>;
    incomingCall: IncomingCallType | null;
    isInCall: boolean;
    isMuted: boolean;
    isCamOff: boolean;
    isSharing: boolean;
    hasLocalMedia: boolean;
    mediaError: string | null;
    startCall: (callerName?: string) => Promise<void>;
    acceptCall: () => Promise<void>;
    rejectCall: () => void;
    hangUp: () => void;
    enableMedia: () => Promise<void>;
    toggleMute: () => Promise<void>;
    toggleCam: () => Promise<void>;
    toggleScreenShare: () => Promise<void>;
    unlockRemoteAudio: () => Promise<void>;
};

export function useWebRTC(localUserId: string, remoteUserId?: string): UseWebRTCResult {
    const socket = useSocket();
    const peerRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);

    const localVideo = useRef<HTMLVideoElement | null>(null);
    const remoteVideo = useRef<HTMLVideoElement | null>(null);

    const [incomingCall, setIncomingCall] = useState<IncomingCallType | null>(null);
    const [isInCall, setIsInCall] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const isSharingRef = useRef(false);
    const [hasLocalMedia, setHasLocalMedia] = useState(false);
    const [mediaError, setMediaError] = useState<string | null>(null);

    const remoteUserIdRef = useRef(remoteUserId);
    const peerSocketIdRef = useRef<string | undefined>(remoteUserId);

    useEffect(() => {
        remoteUserIdRef.current = remoteUserId;
    }, [remoteUserId]);

    useEffect(() => {
        isSharingRef.current = isSharing;
    }, [isSharing]);

    function attachLocalPreview(stream: MediaStream): void {
        if (!localVideo.current) return;
        localVideo.current.srcObject = stream;
        localVideo.current.muted = true;
        void localVideo.current.play().catch(() => undefined);
    }

    function createPeer(): RTCPeerConnection {
        const peer = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        peer.onicecandidate = (event) => {
            const to = peerSocketIdRef.current;
            if (event.candidate && to) {
                socket.emit("iceCandidate", { to, candidate: event.candidate });
            }
        };

        peer.ontrack = (event) => {
            const el = remoteVideo.current;
            if (!el) return;

            if (event.streams[0]) {
                el.srcObject = event.streams[0];
            } else if (event.track) {
                let stream = el.srcObject as MediaStream | null;
                if (!stream) {
                    stream = new MediaStream();
                    el.srcObject = stream;
                }
                if (!stream.getTrackById(event.track.id)) {
                    stream.addTrack(event.track);
                }
            }

            el.muted = false;
            el.defaultMuted = false;
            el.volume = 1;
            void el.play().catch(() => undefined);
        };

        peer.onconnectionstatechange = () => {
            if (peer.connectionState === "failed" || peer.connectionState === "closed") {
                setIsInCall(false);
            }
            if (peer.connectionState === "connected") {
                setIsInCall(true);
            }
        };

        return peer;
    }

    async function ensureLocalStream(): Promise<MediaStream> {
        if (localStreamRef.current) {
            attachLocalPreview(localStreamRef.current);
            return localStreamRef.current;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("Браузер не поддерживает камеру/микрофон. Нужен HTTPS.");
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        localStreamRef.current = stream;
        cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
        setHasLocalMedia(true);
        setMediaError(null);
        setIsMuted(false);
        setIsCamOff(false);
        attachLocalPreview(stream);
        return stream;
    }

    async function enableMedia(): Promise<void> {
        try {
            await ensureLocalStream();
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Не удалось получить доступ к камере/микрофону";
            setMediaError(message);
            throw err;
        }
    }

    async function ensureRemotePlayback(): Promise<void> {
        const el = remoteVideo.current;
        if (!el) return;
        el.muted = false;
        el.defaultMuted = false;
        el.volume = 1;
        try {
            await el.play();
        } catch {
            // user can tap "Звук" button
        }
    }

    function stopScreenShareTracks(): void {
        screenStreamRef.current?.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
    }

    function stopLocalStream(): void {
        stopScreenShareTracks();
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        cameraTrackRef.current = null;
        setHasLocalMedia(false);
        setIsSharing(false);
        if (localVideo.current) localVideo.current.srcObject = null;
    }

    function clearRemoteVideo(): void {
        if (remoteVideo.current) remoteVideo.current.srcObject = null;
    }

    function closePeer(): void {
        peerRef.current?.close();
        peerRef.current = null;
    }

    async function replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
        const peer = peerRef.current;
        if (!peer) return;
        const videoSender = peer.getSenders().find((s) => s.track?.kind === "video");
        if (videoSender) {
            await videoSender.replaceTrack(track);
            return;
        }
        if (track && localStreamRef.current) {
            peer.addTrack(track, localStreamRef.current);
        }
    }

    async function restoreCameraFromShare(): Promise<void> {
        stopScreenShareTracks();
        const cam = cameraTrackRef.current;
        if (cam && localStreamRef.current) {
            localStreamRef.current.getVideoTracks().forEach((t) => {
                if (t !== cam) {
                    localStreamRef.current?.removeTrack(t);
                    t.stop();
                }
            });
            if (!localStreamRef.current.getVideoTracks().includes(cam)) {
                localStreamRef.current.addTrack(cam);
            }
            cam.enabled = true;
            setIsCamOff(false);
            attachLocalPreview(localStreamRef.current);
            if (peerRef.current) await replaceVideoTrack(cam);
        }
        isSharingRef.current = false;
        setIsSharing(false);
    }

    const hangUp = (): void => {
        const to = peerSocketIdRef.current;
        if (to) socket.emit("endCall", { to });
        closePeer();
        clearRemoteVideo();
        if (isSharingRef.current) {
            void restoreCameraFromShare();
        }
        setIsInCall(false);
        setIncomingCall(null);
        peerSocketIdRef.current = remoteUserIdRef.current;
    };

    const startCall = async (callerName?: string): Promise<void> => {
        if (!remoteUserId || localUserId === "pending" || !localUserId) {
            setMediaError("Сокет ещё не подключён — подождите секунду");
            return;
        }
        try {
            peerSocketIdRef.current = remoteUserId;
            closePeer();
            peerRef.current = createPeer();

            const stream = await ensureLocalStream();
            stream.getTracks().forEach((track) => peerRef.current?.addTrack(track, stream));

            const offer = await peerRef.current.createOffer();
            await peerRef.current.setLocalDescription(offer);

            socket.emit("callUser", {
                userToCall: remoteUserId,
                signal: offer,
                from: localUserId,
                name: callerName ?? "Caller",
            });
            setIsInCall(true);
            await ensureRemotePlayback();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Не удалось начать звонок";
            setMediaError(message);
        }
    };

    const acceptCall = async (): Promise<void> => {
        if (!incomingCall) return;
        try {
            peerSocketIdRef.current = incomingCall.from;
            closePeer();
            peerRef.current = createPeer();

            const stream = await ensureLocalStream();
            stream.getTracks().forEach((track) => peerRef.current?.addTrack(track, stream));

            await peerRef.current.setRemoteDescription(new RTCSessionDescription(incomingCall.signal));
            const answer = await peerRef.current.createAnswer();
            await peerRef.current.setLocalDescription(answer);

            socket.emit("answerCall", { to: incomingCall.from, signal: answer });
            setIncomingCall(null);
            setIsInCall(true);
            await ensureRemotePlayback();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Не удалось принять звонок";
            setMediaError(message);
        }
    };

    const rejectCall = (): void => {
        if (incomingCall) {
            socket.emit("endCall", { to: incomingCall.from });
        }
        setIncomingCall(null);
    };

    const toggleMute = async (): Promise<void> => {
        try {
            const stream = await ensureLocalStream();
            const track = stream.getAudioTracks()[0];
            if (!track) {
                setMediaError("Микрофон не найден");
                return;
            }
            track.enabled = !track.enabled;
            setIsMuted(!track.enabled);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Нет доступа к микрофону";
            setMediaError(message);
        }
    };

    const toggleCam = async (): Promise<void> => {
        if (isSharing) {
            setMediaError("Сначала остановите демонстрацию экрана");
            return;
        }
        try {
            const stream = await ensureLocalStream();
            const track = stream.getVideoTracks()[0];
            if (!track) {
                setMediaError("Камера не найдена");
                return;
            }
            track.enabled = !track.enabled;
            setIsCamOff(!track.enabled);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Нет доступа к камере";
            setMediaError(message);
        }
    };

    const toggleScreenShare = async (): Promise<void> => {
        try {
            if (isSharingRef.current) {
                await restoreCameraFromShare();
                return;
            }

            if (!navigator.mediaDevices?.getDisplayMedia) {
                setMediaError("Демонстрация экрана не поддерживается в этом браузере");
                return;
            }

            await ensureLocalStream();
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false,
            });
            const screenTrack = screenStream.getVideoTracks()[0];
            if (!screenTrack) return;

            screenStreamRef.current = screenStream;
            const cam = localStreamRef.current?.getVideoTracks()[0] ?? cameraTrackRef.current;
            if (cam) cameraTrackRef.current = cam;

            if (localStreamRef.current && cam) {
                localStreamRef.current.removeTrack(cam);
                localStreamRef.current.addTrack(screenTrack);
            }

            attachLocalPreview(localStreamRef.current!);
            if (peerRef.current) await replaceVideoTrack(screenTrack);
            isSharingRef.current = true;
            setIsSharing(true);
            setIsCamOff(false);

            screenTrack.onended = () => {
                void restoreCameraFromShare();
            };
        } catch (err) {
            if (err instanceof DOMException && err.name === "NotAllowedError") {
                return;
            }
            const message = err instanceof Error ? err.message : "Не удалось начать демонстрацию";
            setMediaError(message);
        }
    };

    const unlockRemoteAudio = async (): Promise<void> => {
        await ensureRemotePlayback();
    };

    useEffect(() => {
        return () => {
            closePeer();
            stopLocalStream();
            clearRemoteVideo();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const onIncoming = ({
            from,
            signal,
            name,
        }: {
            from: string;
            signal: RTCSessionDescriptionInit;
            name?: string;
        }) => {
            peerSocketIdRef.current = from;
            setIncomingCall({ from, signal, name });
        };

        const onAccepted = async (signal: RTCSessionDescriptionInit) => {
            if (!peerRef.current) return;
            await peerRef.current.setRemoteDescription(new RTCSessionDescription(signal));
            setIsInCall(true);
            await ensureRemotePlayback();
        };

        const onIce = async (candidate: RTCIceCandidateInit) => {
            try {
                await peerRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.error("Error adding ICE candidate", err);
            }
        };

        const onEnded = () => {
            closePeer();
            clearRemoteVideo();
            setIsInCall(false);
            setIncomingCall(null);
        };

        socket.on("incomingCall", onIncoming);
        socket.on("callAccepted", onAccepted);
        socket.on("iceCandidate", onIce);
        socket.on("callEnded", onEnded);

        return () => {
            socket.off("incomingCall", onIncoming);
            socket.off("callAccepted", onAccepted);
            socket.off("iceCandidate", onIce);
            socket.off("callEnded", onEnded);
        };
    }, [socket]);

    return {
        localVideo,
        remoteVideo,
        incomingCall,
        isInCall,
        isMuted,
        isCamOff,
        isSharing,
        hasLocalMedia,
        mediaError,
        startCall,
        acceptCall,
        rejectCall,
        hangUp,
        enableMedia,
        toggleMute,
        toggleCam,
        toggleScreenShare,
        unlockRemoteAudio,
    };
}
