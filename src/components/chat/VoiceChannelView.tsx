import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { Mic, MicOff, Headphones, EarOff, LogIn, LogOut, Volume2, Activity, Shield, Signal, Video, VideoOff, MonitorUp, MonitorX, Maximize2, Minimize2, VolumeX, RefreshCw, Crown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { audioEngine } from '../../services/audio-engine';
import { getSocket } from '../../services/socket-client';
import { isBackendEnabled } from '../../lib/env';
import { getPrimaryMemberRole, getRoleNamePresentation, getRoleSolidColor } from '../../lib/role-style';

const shouldLogVoiceDebug = () => {
  if (typeof window === 'undefined') return process.env.NODE_ENV !== 'production';
  try {
    if (window.localStorage.getItem('diavlocord-debug-voice') === '1') return true;
  } catch {}
  return process.env.NODE_ENV !== 'production';
};

const voiceDebugLog = (...args: unknown[]) => {
  if (!shouldLogVoiceDebug()) return;
  console.log(...args);
};

const voiceDebugWarn = (...args: unknown[]) => {
  if (!shouldLogVoiceDebug()) return;
  console.warn(...args);
};

const MediaVideo = React.memo(function MediaVideo({
  stream,
  muted,
  fit = 'cover',
  onFirstFrame,
  aggressiveRecovery = true,
}: {
  stream: MediaStream;
  muted: boolean;
  fit?: 'cover' | 'contain';
  onFirstFrame?: () => void;
  aggressiveRecovery?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Assign stream only when it really changes.
    if ((el as any).srcObject !== stream) {
      (el as any).srcObject = stream;
    }

    let cancelled = false;
    const tryPlay = (attempt: number) => {
      if (cancelled) return;
      const p = el.play();
      if (p && typeof (p as any).catch === 'function') {
        (p as any).catch(() => {
          if (attempt < 5) setTimeout(() => tryPlay(attempt + 1), 120);
        });
      }
    };

    const tryRecoverBlack = (attempt: number) => {
      if (cancelled) return;
      // If the video never gets dimensions, it is likely stuck (Opera/Chromium bug).
      if (el.videoWidth === 0 || el.videoHeight === 0) {
        if (attempt >= 5) return;
        (el as any).srcObject = null;
        (el as any).srcObject = stream;
        tryPlay(0);
        setTimeout(() => tryRecoverBlack(attempt + 1), 200);
      }
    };

    const tryRecoverNoFrames = (attempt: number) => {
      if (cancelled) return;
      if (attempt >= 5) return;
      const hasVfc = typeof (el as any).requestVideoFrameCallback === 'function';
      if (!hasVfc) return;

      let gotFrame = false;
      let vfcId: number | null = null;
      try {
        vfcId = (el as any).requestVideoFrameCallback(() => {
          gotFrame = true;
          if (!firedRef.current) {
            firedRef.current = true;
            onFirstFrame?.();
          }
        });
      } catch {
        return;
      }

      setTimeout(() => {
        if (cancelled) return;
        // If we didn't receive a frame shortly after starting, force a re-sync.
        if (!gotFrame) {
          (el as any).srcObject = null;
          (el as any).srcObject = stream;
          tryPlay(0);
          setTimeout(() => tryRecoverNoFrames(attempt + 1), 250);
        }
      }, 350);
    };

    const track = stream.getVideoTracks()[0];
    const onUnmute = () => tryPlay(0);
    if (track) {
      try { (track as any).contentHint = 'detail'; } catch {}
      try {
        track.addEventListener('unmute', onUnmute);
      } catch {}
    }

    tryPlay(0);
    if (aggressiveRecovery) {
      setTimeout(() => tryRecoverBlack(0), 250);
      setTimeout(() => tryRecoverNoFrames(0), 500);
    }
    return () => {
      cancelled = true;
      if (track) {
        try {
          track.removeEventListener('unmute', onUnmute);
        } catch {}
      }
    };
  }, [stream, muted, onFirstFrame, aggressiveRecovery]);

  return (
    <video
      ref={ref}
      className={cn(
        "w-full h-full",
        fit === 'contain' ? "object-contain" : "object-cover"
      )}
      autoPlay
      playsInline
      muted={muted}
      controls={false}
      disablePictureInPicture
      onLoadedData={() => {
        if (!firedRef.current) {
          firedRef.current = true;
          onFirstFrame?.();
        }
      }}
      onLoadedMetadata={() => {
        const el = ref.current;
        if (!el) return;
        const p = el.play();
        if (p && typeof (p as any).catch === 'function') (p as any).catch(() => {});
      }}
    />
  );
});

const VideoTile = React.memo(function VideoTile({
  stream,
  label,
  highlight,
  className,
  videoKeyExtra,
  fit = 'cover',
  onClick,
  onFirstFrame,
  aggressiveRecovery = true,
  isExpanded = false,
}: {
  stream: MediaStream;
  label: string;
  highlight?: boolean;
  className?: string;
  videoKeyExtra?: string;
  fit?: 'cover' | 'contain';
  onClick?: () => void;
  onFirstFrame?: () => void;
  aggressiveRecovery?: boolean;
  isExpanded?: boolean;
}) {
  const videoTrack = stream.getVideoTracks()[0];
  const streamKey = `${stream.id}-${videoTrack?.id || 'no-track'}-${videoKeyExtra || ''}`;

  return (
    <div className={cn(
      'relative h-full rounded-[32px] overflow-hidden border border-white/[0.05] bg-white/[0.02] shadow-2xl',
      highlight ? 'ring-2 ring-neon-green/30' : '',
      className
    )}>
      <div className="absolute inset-0 bg-black/10" />
      <MediaVideo
        key={streamKey}
        stream={stream}
        muted
        fit={fit}
        onFirstFrame={onFirstFrame}
        aggressiveRecovery={aggressiveRecovery}
      />
      <div className="absolute left-4 bottom-4 px-3 py-1.5 rounded-full bg-black/55 border border-white/10 text-white text-xs font-black tracking-tight">
        {label}
      </div>
      {onClick ? (
        <button
          onClick={onClick}
          className="absolute right-4 top-4 w-9 h-9 rounded-full bg-black/55 border border-white/10 text-white hover:bg-black/70 transition-colors flex items-center justify-center"
          aria-label="Toggle camera size"
        >
          {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      ) : null}
    </div>
  );
});

type Props = { channelId: string; channelName: string };

const CAMERA_FULL_PRESETS: MediaTrackConstraints[] = [
  { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' },
  { width: { ideal: 1600, max: 1600 }, height: { ideal: 900, max: 900 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' },
  { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' },
  { width: { ideal: 960, max: 960 }, height: { ideal: 540, max: 540 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
];

const CAMERA_PIP_PRESETS: MediaTrackConstraints[] = [
  { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
  { width: { ideal: 960, max: 960 }, height: { ideal: 540, max: 540 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
  { width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 360 }, frameRate: { ideal: 20, max: 24 }, facingMode: 'user' },
];

const SCREEN_TRACK_PRESETS: MediaTrackConstraints[] = [
  { width: { ideal: 2560, max: 2560 }, height: { ideal: 1440, max: 1440 }, frameRate: { ideal: 30, max: 30 } },
  { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } },
  { width: { ideal: 1600, max: 1600 }, height: { ideal: 900, max: 900 }, frameRate: { ideal: 24, max: 30 } },
];

const TURN_URLS = (process.env.NEXT_PUBLIC_TURN_URL || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const TURN_USERNAME = (process.env.NEXT_PUBLIC_TURN_USERNAME || '').trim();
const TURN_CREDENTIAL = (process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '').trim();

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    // Public TURN fallback so calls work on restrictive NATs without extra setup.
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    ...(TURN_URLS.length > 0
      ? [
          {
            urls: TURN_URLS.length === 1 ? TURN_URLS[0] : TURN_URLS,
            ...(TURN_USERNAME ? { username: TURN_USERNAME } : {}),
            ...(TURN_CREDENTIAL ? { credential: TURN_CREDENTIAL } : {}),
          } satisfies RTCIceServer,
        ]
      : []),
  ],
  iceCandidatePoolSize: 6,
};

const getUserMediaWithFallback = async (
  presets: MediaTrackConstraints[],
  preferredDeviceId?: string | null
): Promise<{ stream: MediaStream; presetIndex: number }> => {
  let lastError: unknown;
  for (let i = 0; i < presets.length; i += 1) {
    const candidates: Array<MediaTrackConstraints | boolean> = preferredDeviceId
      ? [
          { ...presets[i], deviceId: { exact: preferredDeviceId } },
          { ...presets[i], deviceId: { ideal: preferredDeviceId } },
          presets[i],
        ]
      : [presets[i]];
    for (const videoConstraints of candidates) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
        return { stream, presetIndex: i };
      } catch (err) {
        lastError = err;
      }
    }
  }
  const finalCandidates: Array<MediaTrackConstraints | boolean> = preferredDeviceId
    ? [{ deviceId: { ideal: preferredDeviceId } }, true]
    : [true];
  for (const videoConstraints of finalCandidates) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
      return { stream, presetIndex: presets.length - 1 };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('camera_unavailable');
};

const applyTrackConstraintsWithFallback = async (
  track: MediaStreamTrack,
  presets: MediaTrackConstraints[]
): Promise<number> => {
  for (let i = 0; i < presets.length; i += 1) {
    try {
      await track.applyConstraints(presets[i]);
      return i;
    } catch {}
  }
  return -1;
};

export const VoiceChannelView = ({ channelId, channelName }: Props) => {
  const currentUser = useStore(s => s.currentUser);
  const servers = useStore(s => s.servers);
  const activeServerId = useStore(s => s.activeServerId);
  const users = useStore(s => s.users);
  const voice = useStore(s => s.voice[channelId]);
  const voiceMember = useStore(s => s.voiceMember[currentUser.id] || { muted: false, deafened: false });
  const voiceMemberMap = useStore(s => s.voiceMember);
  const voiceJoin = useStore(s => s.voiceJoin);
  const voiceLeave = useStore(s => s.voiceLeave);
  const setVoiceMemberState = useStore(s => s.setVoiceMemberState);
  const mediaSettings = useStore(s => s.mediaSettings);
  const backendToken = useStore(s => s.backendToken);

  const connected = voice?.connectedUserIds || [];
  const speaking = new Set(voice?.speakingUserIds || []);

  const isInChannel = connected.includes(currentUser.id);

  const setSpeaking = useStore(s => s.setSpeaking);
  const [audioInitialized, setAudioInitialized] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraExpanded, setCameraExpanded] = useState(false);
  const [joinDeniedMessage, setJoinDeniedMessage] = useState<string | null>(null);
  const [badgePulse, setBadgePulse] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'connecting' | 'live' | 'stalled'>('idle');
  const [cameraRetryCount, setCameraRetryCount] = useState(0);
  const [cameraCaptureVersion, setCameraCaptureVersion] = useState(0);
  const [screenStatus, setScreenStatus] = useState<'idle' | 'connecting' | 'live' | 'stalled'>('idle');
  const [screenRetryCount, setScreenRetryCount] = useState(0);
  const screenWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenHealthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRetryCountRef = useRef(0);
  const cameraRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraRetryCountRef = useRef(0);
  const audioInputRef = useRef<string | null>(null);
  const audioQualityRef = useRef<string | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const remoteAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const blockedRemoteAudioRef = useRef<Set<string>>(new Set());
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const pendingOfferRef = useRef<Map<string, boolean>>(new Map());
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const renegotiateCooldownRef = useRef<Map<string, number>>(new Map());
  const negotiationCooldownRef = useRef<Map<string, number>>(new Map());
  const outboundTrackKeyRef = useRef<string>('');
  const localSpeakingRef = useRef(false);
  const noiseFloorRef = useRef(0.008);
  const lastSpeechAtRef = useRef(0);
  const speakingStateChangedAtRef = useRef(0);
  const smoothedAudioLevelRef = useRef(0);
  const lastAudioLevelCommitAtRef = useRef(0);
  const [remoteVideoStreams, setRemoteVideoStreams] = useState<Array<{ userId: string; stream: MediaStream }>>([]);
  const [linkHealth, setLinkHealth] = useState<'offline' | 'connecting' | 'stable' | 'unstable'>('offline');

  const hasVideo = !!cameraStream || !!screenStream || remoteVideoStreams.length > 0;
  const [screenExpanded, setScreenExpanded] = useState(false);
  const activeServer = activeServerId ? servers.find((server) => server.id === activeServerId) || null : null;
  const activeChannel = activeServer
    ? activeServer.categories.flatMap((category) => category.channels).find((channel) => channel.id === channelId) || null
    : null;
  const channelUserLimit =
    activeChannel?.type === 'voice' && typeof activeChannel.userLimit === 'number' && activeChannel.userLimit > 0
      ? activeChannel.userLimit
      : null;
  const isChannelFull = !isInChannel && Boolean(channelUserLimit && connected.length >= channelUserLimit);

  useEffect(() => {
    cameraStreamRef.current = cameraStream;
  }, [cameraStream]);

  useEffect(() => {
    screenStreamRef.current = screenStream;
  }, [screenStream]);

  const handleScreenFirstFrame = useCallback(() => {
    setScreenStatus('live');
    autoRetryCountRef.current = 0;
    setScreenRetryCount(0);
    if (screenWatchdogRef.current) {
      clearTimeout(screenWatchdogRef.current);
      screenWatchdogRef.current = null;
    }
    if (autoRetryTimerRef.current) {
      clearTimeout(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
  }, []);

  const stopStream = (s: MediaStream | null) => {
    if (!s) return;
    s.getTracks().forEach((t) => t.stop());
  };

  const updateRemoteVideoStreams = () => {
    const next: Array<{ userId: string; stream: MediaStream }> = [];
    for (const [userId, stream] of Array.from(peerStreamsRef.current.entries())) {
      const hasVideoTrack = stream.getVideoTracks().some((track) => track.readyState === 'live');
      if (hasVideoTrack) next.push({ userId, stream });
    }
    next.sort((a, b) => a.userId.localeCompare(b.userId));
    setRemoteVideoStreams(next);
  };

  const getVoiceSocket = () => {
    if (!isBackendEnabled || !backendToken) return null;
    const socket = getSocket(backendToken);
    if (!socket) return null;
    try {
      socket.connect();
    } catch {}
    return socket;
  };

  const shouldInitiateOffer = useCallback(
    (remoteUserId: string) => currentUser.id.localeCompare(remoteUserId) < 0,
    [currentUser.id]
  );

  const setLocalSpeakingState = (nextValue: boolean) => {
    if (localSpeakingRef.current === nextValue) return;
    localSpeakingRef.current = nextValue;
    setSpeaking(channelId, currentUser.id, nextValue);
  };

  const applyRemoteAudioOutput = (audioEl: HTMLAudioElement) => {
    audioEl.autoplay = true;
    audioEl.setAttribute('playsinline', 'true');
    audioEl.muted = voiceMember.deafened;
    audioEl.volume = voiceMember.deafened ? 0 : Math.max(0, Math.min(1, mediaSettings.speakerVolume));
    if (mediaSettings.outputDeviceId && typeof (audioEl as any).setSinkId === 'function') {
      (audioEl as any).setSinkId(mediaSettings.outputDeviceId).catch(() => {});
    }
  };

  const tryPlayRemoteAudio = (remoteUserId: string) => {
    const audioEl = remoteAudioElsRef.current.get(remoteUserId);
    if (!audioEl) return;
    // Ensure the element is not muted by browser defaults
    audioEl.muted = false;
    audioEl.autoplay = true;
    const p = audioEl.play();
    if (p && typeof (p as any).catch === 'function') {
      (p as any)
        .then(() => {
          voiceDebugLog('[voice-debug] audio play() OK for', remoteUserId, 'vol:', audioEl.volume, 'muted:', audioEl.muted, 'paused:', audioEl.paused);
          blockedRemoteAudioRef.current.delete(remoteUserId);
        })
        .catch((err: any) => {
          voiceDebugWarn('[voice-debug] audio play() BLOCKED for', remoteUserId, err?.name || err);
          blockedRemoteAudioRef.current.add(remoteUserId);
        });
    }
  };

  const ensureRemoteAudioElement = (remoteUserId: string, stream: MediaStream) => {
    let audioEl = remoteAudioElsRef.current.get(remoteUserId);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.setAttribute('data-voice-remote', remoteUserId);
      audioEl.setAttribute('playsinline', 'true');
      audioEl.style.position = 'fixed';
      audioEl.style.width = '1px';
      audioEl.style.height = '1px';
      audioEl.style.opacity = '0';
      audioEl.style.pointerEvents = 'none';
      audioEl.style.left = '-9999px';
      audioEl.style.top = '-9999px';
      try {
        document.body.appendChild(audioEl);
      } catch {}
      remoteAudioElsRef.current.set(remoteUserId, audioEl);
    }
    applyRemoteAudioOutput(audioEl);
    (audioEl as any).srcObject = stream;
    tryPlayRemoteAudio(remoteUserId);
  };

  const removeRemoteAudioElement = (remoteUserId: string) => {
    const audioEl = remoteAudioElsRef.current.get(remoteUserId);
    if (!audioEl) return;
    audioEl.pause();
    (audioEl as any).srcObject = null;
    try {
      audioEl.remove();
    } catch {}
    remoteAudioElsRef.current.delete(remoteUserId);
    blockedRemoteAudioRef.current.delete(remoteUserId);
  };

  const buildLocalOutboundTracks = (): MediaStreamTrack[] => {
    const tracks: MediaStreamTrack[] = [];
    const localAudioTrack =
      audioEngine.getOutboundStream()?.getAudioTracks()?.[0] ||
      audioEngine.getLocalStream()?.getAudioTracks()?.[0] ||
      null;
    if (localAudioTrack) {
      tracks.push(localAudioTrack);
    }
    const localVideoTrack =
      screenStreamRef.current?.getVideoTracks()?.[0] || cameraStreamRef.current?.getVideoTracks()?.[0] || null;
    if (localVideoTrack) tracks.push(localVideoTrack);
    return tracks;
  };

  const syncPeerTracks = (pc: RTCPeerConnection) => {
    const outboundTracks = buildLocalOutboundTracks();
    const desiredByKind = new Map<string, MediaStreamTrack>();
    for (const track of outboundTracks) desiredByKind.set(track.kind, track);

    const transceivers = pc.getTransceivers();
    const usedKinds = new Set<string>();
    for (const transceiver of transceivers) {
      const stopped = (transceiver as RTCRtpTransceiver & { stopped?: boolean }).stopped === true;
      if (stopped) continue;
      const dir = transceiver.currentDirection || transceiver.direction;
      if (!dir) continue;
      // Determine kind from the mid or from the sender/receiver track
      const kind = transceiver.sender.track?.kind
        || transceiver.receiver.track?.kind
        || (transceiver.mid !== null ? undefined : undefined);
      if (!kind) continue;
      // Only use the first transceiver per kind for sending
      if (usedKinds.has(kind)) continue;
      usedKinds.add(kind);
      const desiredTrack = desiredByKind.get(kind);
      if (!desiredTrack) {
        if (transceiver.sender.track) {
          transceiver.sender.replaceTrack(null).catch(() => {});
        }
        try {
          if (transceiver.direction === 'sendrecv') transceiver.direction = 'recvonly';
        } catch {}
        continue;
      }
      try {
        if (transceiver.direction === 'recvonly' || transceiver.direction === 'inactive') {
          transceiver.direction = 'sendrecv';
        }
      } catch {}
      if (transceiver.sender.track?.id !== desiredTrack.id) {
        transceiver.sender.replaceTrack(desiredTrack).catch(() => {});
      }
      desiredByKind.delete(kind);
    }

    for (const track of Array.from(desiredByKind.values())) {
      try {
        pc.addTrack(track, new MediaStream([track]));
      } catch {}
    }

    const audioConfig = audioEngine.getConfig();
    const targetBitrate = Math.max(64000, Math.min(256000, Math.floor(audioConfig.bitRate || 128000)));
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'audio') continue;
      try {
        const parameters = sender.getParameters();
        const sourceEncodings =
          Array.isArray(parameters.encodings) && parameters.encodings.length > 0
            ? parameters.encodings
            : [{}];
        let changed = false;
        const nextEncodings = sourceEncodings.map((encoding) => {
          const next = { ...encoding };
          if (next.maxBitrate !== targetBitrate) {
            next.maxBitrate = targetBitrate;
            changed = true;
          }
          return next;
        });
        if (!changed) continue;
        parameters.encodings = nextEncodings;
        sender.setParameters(parameters).catch(() => {});
      } catch {}
    }
  };

  const closePeerConnection = (remoteUserId: string) => {
    const pc = peerConnectionsRef.current.get(remoteUserId);
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
      } catch {}
      peerConnectionsRef.current.delete(remoteUserId);
    }
    makingOfferRef.current.delete(remoteUserId);
    pendingOfferRef.current.delete(remoteUserId);
    pendingIceCandidatesRef.current.delete(remoteUserId);
    renegotiateCooldownRef.current.delete(remoteUserId);
    negotiationCooldownRef.current.delete(remoteUserId);
    peerStreamsRef.current.delete(remoteUserId);
    removeRemoteAudioElement(remoteUserId);
    updateRemoteVideoStreams();
  };

  const flushPendingIceCandidates = async (remoteUserId: string, pc: RTCPeerConnection) => {
    const queued = pendingIceCandidatesRef.current.get(remoteUserId);
    if (!queued || queued.length === 0) return;
    pendingIceCandidatesRef.current.delete(remoteUserId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        voiceDebugWarn('[voice] queued ice failed', err);
      }
    }
  };

  const sendOffer = async (remoteUserId: string) => {
    const socket = getVoiceSocket();
    if (!socket) return;
    const pc = peerConnectionsRef.current.get(remoteUserId);
    if (!pc) return;
    if (pc.signalingState !== 'stable') {
      pendingOfferRef.current.set(remoteUserId, true);
      return;
    }
    if (makingOfferRef.current.get(remoteUserId)) {
      pendingOfferRef.current.set(remoteUserId, true);
      return;
    }

    makingOfferRef.current.set(remoteUserId, true);
    pendingOfferRef.current.set(remoteUserId, false);
    try {
      syncPeerTracks(pc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!pc.localDescription) return;
      voiceDebugLog('[voice-debug] sending offer →', remoteUserId, 'tracks:', pc.getSenders().map(s => s.track?.kind + ':' + s.track?.readyState).join(', '));
      socket.emit('webrtc:offer', {
        channelId,
        toUserId: remoteUserId,
        sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      });
    } catch (err) {
      console.error('[voice] offer failed', err);
      pendingOfferRef.current.set(remoteUserId, true);
    } finally {
      makingOfferRef.current.set(remoteUserId, false);
      const stillPending = pendingOfferRef.current.get(remoteUserId);
      const activePc = peerConnectionsRef.current.get(remoteUserId);
      if (stillPending && activePc && activePc.signalingState === 'stable') {
        pendingOfferRef.current.set(remoteUserId, false);
        void sendOffer(remoteUserId);
      }
    }
  };

  const ensurePeerConnection = (remoteUserId: string) => {
    const existing = peerConnectionsRef.current.get(remoteUserId);
    if (existing) {
      syncPeerTracks(existing);
      return existing;
    }
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnectionsRef.current.set(remoteUserId, pc);
    voiceDebugLog('[voice-debug] new PeerConnection for', remoteUserId);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      voiceDebugLog('[voice-debug] ICE candidate →', remoteUserId);
      const socket = getVoiceSocket();
      if (!socket) return;
      socket.emit('webrtc:ice-candidate', {
        channelId,
        toUserId: remoteUserId,
        candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
      });
    };

    pc.ontrack = (event) => {
      voiceDebugLog('[voice-debug] ontrack from', remoteUserId, 'kind:', event.track.kind, 'state:', event.track.readyState);
      let stream = peerStreamsRef.current.get(remoteUserId);
      if (!stream) {
        stream = new MediaStream();
        peerStreamsRef.current.set(remoteUserId, stream);
      }
      const incomingTracks =
        event.streams && event.streams.length > 0 ? event.streams[0].getTracks() : [event.track];
      for (const track of incomingTracks) {
        const existingSameKind = stream
          .getTracks()
          .filter((current) => current.kind === track.kind && current.id !== track.id);
        for (const staleTrack of existingSameKind) {
          stream.removeTrack(staleTrack);
        }
        const exists = stream.getTracks().some((current) => current.id === track.id);
        if (!exists) {
          stream.addTrack(track);
          track.addEventListener('mute', () => {
            updateRemoteVideoStreams();
          });
          track.addEventListener('unmute', () => {
            updateRemoteVideoStreams();
          });
          track.addEventListener('ended', () => {
            const targetStream = peerStreamsRef.current.get(remoteUserId);
            if (!targetStream) return;
            const endedTrack = targetStream.getTracks().find((current) => current.id === track.id);
            if (endedTrack) targetStream.removeTrack(endedTrack);
            updateRemoteVideoStreams();
          });
        }
      }
      if (stream.getAudioTracks().length > 0) {
        ensureRemoteAudioElement(remoteUserId, stream);
      }
      updateRemoteVideoStreams();
    };

    const onConnectionStateChange = () => {
      voiceDebugLog('[voice-debug] connection state:', pc.connectionState, 'ice:', pc.iceConnectionState, 'peer:', remoteUserId);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        closePeerConnection(remoteUserId);
      }
    };
    pc.onconnectionstatechange = onConnectionStateChange;
    pc.oniceconnectionstatechange = onConnectionStateChange;
    pc.onnegotiationneeded = () => {
      const now = Date.now();
      const last = negotiationCooldownRef.current.get(remoteUserId) || 0;
      if (now - last < 500) return;
      negotiationCooldownRef.current.set(remoteUserId, now);
      if (!shouldInitiateOffer(remoteUserId)) return;
      if (pc.signalingState !== 'stable') {
        pendingOfferRef.current.set(remoteUserId, true);
        return;
      }
      void sendOffer(remoteUserId);
    };
    pc.onsignalingstatechange = () => {
      if (pc.signalingState !== 'stable') return;
      if (!pendingOfferRef.current.get(remoteUserId)) return;
      pendingOfferRef.current.set(remoteUserId, false);
      void sendOffer(remoteUserId);
    };

    syncPeerTracks(pc);
    return pc;
  };

  const forceResyncPeers = () => {
    if (!isInChannel || !audioInitialized || !isBackendEnabled || !backendToken) return;
    const remoteUserIds = connected.filter((id) => id !== currentUser.id);
    for (const remoteUserId of remoteUserIds) {
      const pc = ensurePeerConnection(remoteUserId);
      syncPeerTracks(pc);
      if (shouldInitiateOffer(remoteUserId)) {
        void sendOffer(remoteUserId);
      }
    }
  };

  const clearCameraRetryTimer = () => {
    if (cameraRetryTimerRef.current) {
      clearTimeout(cameraRetryTimerRef.current);
      cameraRetryTimerRef.current = null;
    }
  };

  const scheduleCameraRetry = () => {
    if (!cameraEnabled || !isInChannel) return;
    if (cameraRetryCountRef.current >= 2) return;
    clearCameraRetryTimer();
    cameraRetryCountRef.current += 1;
    setCameraRetryCount(cameraRetryCountRef.current);
    const delay = 550 + cameraRetryCountRef.current * 420;
    cameraRetryTimerRef.current = setTimeout(() => {
      setCameraCaptureVersion((value) => value + 1);
    }, delay);
  };

  const clearScreenTimers = () => {
    if (screenWatchdogRef.current) {
      clearTimeout(screenWatchdogRef.current);
      screenWatchdogRef.current = null;
    }
    if (screenHealthIntervalRef.current) {
      clearInterval(screenHealthIntervalRef.current);
      screenHealthIntervalRef.current = null;
    }
    if (autoRetryTimerRef.current) {
      clearTimeout(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
  };

  const stopScreenShare = (resetUi = true) => {
    clearScreenTimers();
    stopStream(screenStreamRef.current);
    if (!resetUi) return;
    setScreenStream(null);
    setScreenEnabled(false);
    setScreenStatus('idle');
    autoRetryCountRef.current = 0;
    setScreenRetryCount(0);
    window.setTimeout(() => {
      forceResyncPeers();
    }, 60);
  };

  const startScreenShare = async () => {
    if (!isInChannel) return;
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setScreenEnabled(false);
      setScreenStream(null);
      setScreenStatus('stalled');
      return;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      setScreenStatus('stalled');
      return;
    }
    clearScreenTimers();
    setScreenStatus('connecting');
    try {
      const getDisplayMedia = (navigator.mediaDevices as any).getDisplayMedia?.bind(navigator.mediaDevices);
      const attempts: any[] = [
        {
          video: {
            width: { ideal: 2560, max: 3840 },
            height: { ideal: 1440, max: 2160 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
          preferCurrentTab: true,
          surfaceSwitching: 'include',
          selfBrowserSurface: 'exclude',
        },
        {
          video: {
            width: { ideal: 1920, max: 2560 },
            height: { ideal: 1080, max: 1440 },
            frameRate: { ideal: 30, max: 60 },
          },
          audio: false,
        },
        {
          video: true,
          audio: false,
        },
      ];
      let s: MediaStream | null = null;
      let lastError: unknown = null;
      for (const constraints of attempts) {
        try {
          s = await getDisplayMedia(constraints);
          if (s) break;
        } catch (error) {
          lastError = error;
          const name = (error as any)?.name;
          if (name === 'NotAllowedError' || name === 'AbortError') {
            setScreenEnabled(false);
            setScreenStream(null);
            setScreenStatus('idle');
            return;
          }
        }
      }
      if (!s) {
        throw lastError ?? new Error('display_media_unavailable');
      }

      const [track] = s.getVideoTracks();
      if (!track) {
        throw new Error('screen_track_missing');
      }
      if (track) {
        try { (track as any).contentHint = 'detail'; } catch {}
        await applyTrackConstraintsWithFallback(track, SCREEN_TRACK_PRESETS);
        track.addEventListener('ended', () => {
          stopScreenShare();
        });
        track.addEventListener('mute', () => {
          setScreenStatus('stalled');
        });
        track.addEventListener('unmute', () => {
          setScreenStatus('connecting');
        });
      }

      const prev = screenStreamRef.current;
      if (prev && prev.id !== s.id) stopStream(prev);
      setScreenStream(s);
      setScreenEnabled(true);
      window.setTimeout(() => {
        forceResyncPeers();
      }, 80);

      if (screenWatchdogRef.current) clearTimeout(screenWatchdogRef.current);
      screenWatchdogRef.current = setTimeout(() => {
        setScreenStatus((prevStatus) => (prevStatus === 'live' ? prevStatus : 'stalled'));
      }, 4200);

      if (screenHealthIntervalRef.current) clearInterval(screenHealthIntervalRef.current);
      screenHealthIntervalRef.current = setInterval(() => {
        const currentTrack = s.getVideoTracks()[0];
        if (!currentTrack) return;
        if (currentTrack.readyState === 'ended') {
          setScreenStatus('stalled');
          return;
        }
        if ((currentTrack as any).muted) {
          setScreenStatus((prevStatus) => (prevStatus === 'live' ? prevStatus : 'connecting'));
        }
      }, 900);
    } catch (e) {
      console.error('Screen share error', e);
      const name = (e as any)?.name;
      setScreenEnabled(false);
      setScreenStream(null);
      setScreenStatus(name === 'NotAllowedError' || name === 'AbortError' ? 'idle' : 'stalled');
    }
  };

  const restartScreenShare = () => {
    autoRetryCountRef.current = 0;
    setScreenRetryCount(0);
    void startScreenShare();
  };

  // Initialize high-quality audio when joining channel
  useEffect(() => {
    const inputChanged = audioInputRef.current !== mediaSettings.inputDeviceId;
    const qualityChanged = audioQualityRef.current !== mediaSettings.voiceQuality;
    if (isInChannel && (!audioInitialized || inputChanged || qualityChanged)) {
      audioEngine.initialize({
        profile: mediaSettings.voiceQuality,
        inputDeviceId: mediaSettings.inputDeviceId,
        microphoneVolume: mediaSettings.microphoneVolume,
      }).then(() => {
        setAudioInitialized(true);
        audioInputRef.current = mediaSettings.inputDeviceId;
        audioQualityRef.current = mediaSettings.voiceQuality;
        voiceDebugLog('High-quality audio initialized', audioEngine.getStats());
      }).catch(err => {
        console.error('Failed to initialize audio', err);
      });
    } else if (!isInChannel && audioInitialized) {
      audioEngine.stop();
      setAudioInitialized(false);
      audioInputRef.current = null;
      audioQualityRef.current = null;
      clearCameraRetryTimer();
      cameraRetryCountRef.current = 0;
      setCameraRetryCount(0);
      setCameraStatus('idle');

      setCameraEnabled(false);
      stopScreenShare();
      stopStream(cameraStreamRef.current);
      setCameraStream(null);
    }
  }, [isInChannel, audioInitialized, mediaSettings.inputDeviceId, mediaSettings.microphoneVolume, mediaSettings.voiceQuality]);

  useEffect(() => {
    audioEngine.setMicrophoneVolume(mediaSettings.microphoneVolume);
  }, [mediaSettings.microphoneVolume]);

  useEffect(() => {
    const enabled = isInChannel && !voiceMember.muted;
    const localAudioTrack = audioEngine.getLocalStream()?.getAudioTracks()?.[0] || null;
    if (localAudioTrack) localAudioTrack.enabled = enabled;
    const outboundAudioTrack = audioEngine.getOutboundStream()?.getAudioTracks()?.[0] || null;
    if (outboundAudioTrack) outboundAudioTrack.enabled = enabled;
  }, [isInChannel, voiceMember.muted, audioInitialized]);

  useEffect(() => {
    for (const audioEl of Array.from(remoteAudioElsRef.current.values())) {
      applyRemoteAudioOutput(audioEl);
    }
  }, [mediaSettings.outputDeviceId, mediaSettings.speakerVolume, voiceMember.deafened]);

  useEffect(() => {
    if (!isInChannel) return;
    if (!cameraEnabled) {
      clearCameraRetryTimer();
      cameraRetryCountRef.current = 0;
      setCameraRetryCount(0);
      setCameraStatus('idle');
      stopStream(cameraStreamRef.current);
      setCameraStream(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setCameraStatus('connecting');
        const presets = screenEnabled ? CAMERA_PIP_PRESETS : CAMERA_FULL_PRESETS;
        const { stream: s, presetIndex } = await getUserMediaWithFallback(presets, mediaSettings.cameraDeviceId);
        const [track] = s.getVideoTracks();
        if (track) {
          try { (track as any).contentHint = 'motion'; } catch {}
          if (presetIndex > 0) {
            // A secondary apply can still improve stability on some cameras.
            await applyTrackConstraintsWithFallback(track, presets.slice(presetIndex));
          }
          track.addEventListener('unmute', () => {
            setCameraStatus('live');
          });
          track.addEventListener('mute', () => {
            setCameraStatus('stalled');
          });
          track.addEventListener('ended', () => {
            setCameraStatus('stalled');
            scheduleCameraRetry();
          });
        }
        if (cancelled) {
          stopStream(s);
          return;
        }

        const prev = cameraStreamRef.current;
        if (prev && prev.id !== s.id) stopStream(prev);
        clearCameraRetryTimer();
        cameraRetryCountRef.current = 0;
        setCameraRetryCount(0);
        setCameraStatus('live');
        setCameraStream(s);
        window.setTimeout(() => {
          forceResyncPeers();
        }, 80);
      } catch (e) {
        console.error('Camera error', e);
        setCameraStatus('stalled');
        scheduleCameraRetry();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cameraEnabled, isInChannel, screenEnabled, mediaSettings.cameraDeviceId, cameraCaptureVersion]);

  useEffect(() => {
    if (!isInChannel || !screenEnabled) {
      if (screenStreamRef.current) stopScreenShare();
      else {
        clearScreenTimers();
        setScreenStatus('idle');
        autoRetryCountRef.current = 0;
        setScreenRetryCount(0);
      }
    }
  }, [screenEnabled, isInChannel]);

  useEffect(() => {
    if (!isInChannel || !audioInitialized || !isBackendEnabled || !backendToken) {
      for (const remoteUserId of Array.from(peerConnectionsRef.current.keys())) {
        closePeerConnection(remoteUserId);
      }
      outboundTrackKeyRef.current = '';
      return;
    }

    const remoteUserIds = connected.filter((id) => id !== currentUser.id);
    for (const remoteUserId of Array.from(peerConnectionsRef.current.keys())) {
      if (!remoteUserIds.includes(remoteUserId)) {
        closePeerConnection(remoteUserId);
      }
    }

    for (const remoteUserId of remoteUserIds) {
      const existed = peerConnectionsRef.current.has(remoteUserId);
      ensurePeerConnection(remoteUserId);
      if (!existed && shouldInitiateOffer(remoteUserId)) {
        void sendOffer(remoteUserId);
      }
    }
  }, [
    isInChannel,
    audioInitialized,
    backendToken,
    connected,
    currentUser.id,
    shouldInitiateOffer,
  ]);

  useEffect(() => {
    if (!isInChannel || !audioInitialized || !isBackendEnabled || !backendToken) {
      outboundTrackKeyRef.current = '';
      return;
    }

    const audioTrackId =
      audioEngine.getOutboundStream()?.getAudioTracks()?.[0]?.id ||
      audioEngine.getLocalStream()?.getAudioTracks()?.[0]?.id ||
      'no-audio';
    const videoTrackId =
      screenStreamRef.current?.getVideoTracks()?.[0]?.id ||
      cameraStreamRef.current?.getVideoTracks()?.[0]?.id ||
      'no-video';
    const nextKey = `${audioTrackId}|${videoTrackId}`;
    if (outboundTrackKeyRef.current === nextKey) return;
    outboundTrackKeyRef.current = nextKey;

    const remoteUserIds = connected.filter((id) => id !== currentUser.id);
    for (const remoteUserId of remoteUserIds) {
      const pc = ensurePeerConnection(remoteUserId);
      syncPeerTracks(pc);
      void sendOffer(remoteUserId);
    }
  }, [
    isInChannel,
    backendToken,
    connected,
    currentUser.id,
    cameraStream,
    screenStream,
    audioInitialized,
    mediaSettings.inputDeviceId,
    mediaSettings.voiceQuality,
  ]);

  useEffect(() => {
    if (!isInChannel || !audioInitialized || !isBackendEnabled || !backendToken) return;
    const intervalId = window.setInterval(() => {
      const remoteUserIds = connected.filter((id) => id !== currentUser.id);
      for (const remoteUserId of remoteUserIds) {
        const now = Date.now();
        const pc = peerConnectionsRef.current.get(remoteUserId);
        if (!pc) {
          const lastAttempt = renegotiateCooldownRef.current.get(remoteUserId) || 0;
          if (now - lastAttempt < 2200) continue;
          renegotiateCooldownRef.current.set(remoteUserId, now);
          if (shouldInitiateOffer(remoteUserId)) {
            ensurePeerConnection(remoteUserId);
            void sendOffer(remoteUserId);
          }
          continue;
        }
        const unstable =
          pc.connectionState === 'failed' ||
          pc.connectionState === 'disconnected' ||
          pc.iceConnectionState === 'failed' ||
          pc.iceConnectionState === 'disconnected' ||
          pc.connectionState === 'closed';
        if (unstable) {
          const lastAttempt = renegotiateCooldownRef.current.get(remoteUserId) || 0;
          if (now - lastAttempt < 2200) continue;
          renegotiateCooldownRef.current.set(remoteUserId, now);
          closePeerConnection(remoteUserId);
          if (shouldInitiateOffer(remoteUserId)) {
            ensurePeerConnection(remoteUserId);
            void sendOffer(remoteUserId);
          }
        }
      }
    }, 2500);

    return () => window.clearInterval(intervalId);
  }, [isInChannel, audioInitialized, backendToken, connected, currentUser.id, shouldInitiateOffer]);

  useEffect(() => {
    if (!isInChannel) return;
    const unlock = () => {
      const ctx = audioEngine.getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      for (const remoteUserId of Array.from(blockedRemoteAudioRef.current.values())) {
        tryPlayRemoteAudio(remoteUserId);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('click', unlock, true);
    window.addEventListener('touchstart', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('click', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
    };
  }, [isInChannel]);

  useEffect(() => {
    if (!isInChannel || !isBackendEnabled || !backendToken) return;
    const socket = getVoiceSocket();
    if (!socket) return;

    const syncVoicePresence = () => {
      socket.emit('voice:join', { channelId, userId: currentUser.id });
    };

    if (socket.connected) {
      syncVoicePresence();
    }
    socket.on('connect', syncVoicePresence);

    return () => {
      socket.off('connect', syncVoicePresence);
    };
  }, [isInChannel, backendToken, channelId, currentUser.id]);

  useEffect(() => {
    if (!isBackendEnabled || !backendToken) return;
    const socket = getVoiceSocket();
    if (!socket) return;

    const onVoiceJoinDenied = (payload: {
      channelId?: string;
      userId?: string;
      reason?: string;
      limit?: number;
      connectedCount?: number;
    }) => {
      if (payload?.channelId !== channelId) return;
      if (payload?.userId && payload.userId !== currentUser.id) return;
      voiceLeave(channelId, currentUser.id, false);
      if (payload?.reason === 'limit_reached' && payload.limit) {
        setJoinDeniedMessage(`Canal lleno (${payload.connectedCount || payload.limit}/${payload.limit})`);
      } else if (payload?.reason === 'forbidden') {
        setJoinDeniedMessage('No tienes permiso para unirte');
      } else {
        setJoinDeniedMessage('No se pudo entrar al canal');
      }
    };

    socket.on('voice:join:denied', onVoiceJoinDenied);
    return () => {
      socket.off('voice:join:denied', onVoiceJoinDenied);
    };
  }, [backendToken, channelId, currentUser.id, voiceLeave]);

  useEffect(() => {
    if (!joinDeniedMessage) return;
    const id = window.setTimeout(() => setJoinDeniedMessage(null), 1800);
    return () => window.clearTimeout(id);
  }, [joinDeniedMessage]);

  useEffect(() => {
    if (!isInChannel || !isBackendEnabled || !backendToken) return;
    const socket = getVoiceSocket();
    if (!socket) return;

    const onOffer = async (payload: { channelId?: string; fromUserId?: string; sdp?: { type?: string; sdp?: string } }) => {
      if (!payload?.channelId || payload.channelId !== channelId) return;
      if (!payload?.fromUserId || payload.fromUserId === currentUser.id) return;
      if (!payload?.sdp?.type || !payload?.sdp?.sdp) return;

      voiceDebugLog('[voice-debug] received offer from', payload.fromUserId);
      const pc = ensurePeerConnection(payload.fromUserId);
      try {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setLocalDescription({ type: 'rollback' });
        }
        await pc.setRemoteDescription({ type: payload.sdp.type as RTCSdpType, sdp: payload.sdp.sdp });
        await flushPendingIceCandidates(payload.fromUserId, pc);
        syncPeerTracks(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (!pc.localDescription) return;
        voiceDebugLog('[voice-debug] sending answer →', payload.fromUserId, 'tracks:', pc.getSenders().map(s => s.track?.kind + ':' + s.track?.readyState).join(', '));
        socket.emit('webrtc:answer', {
          channelId,
          toUserId: payload.fromUserId,
          sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        });
      } catch (err) {
        console.error('[voice] offer handling failed', err);
      }
    };

    const onAnswer = async (payload: { channelId?: string; fromUserId?: string; sdp?: { type?: string; sdp?: string } }) => {
      if (!payload?.channelId || payload.channelId !== channelId) return;
      if (!payload?.fromUserId || payload.fromUserId === currentUser.id) return;
      if (!payload?.sdp?.type || !payload?.sdp?.sdp) return;

      const pc = ensurePeerConnection(payload.fromUserId);
      try {
        if (pc.signalingState !== 'have-local-offer') return;
        await pc.setRemoteDescription({ type: payload.sdp.type as RTCSdpType, sdp: payload.sdp.sdp });
        await flushPendingIceCandidates(payload.fromUserId, pc);
      } catch (err) {
        console.error('[voice] answer handling failed', err);
      }
    };

    const onIceCandidate = async (payload: { channelId?: string; fromUserId?: string; candidate?: RTCIceCandidateInit }) => {
      if (!payload?.channelId || payload.channelId !== channelId) return;
      if (!payload?.fromUserId || payload.fromUserId === currentUser.id) return;
      if (!payload?.candidate) return;

      const pc = ensurePeerConnection(payload.fromUserId);
      try {
        if (!pc.remoteDescription) {
          const current = pendingIceCandidatesRef.current.get(payload.fromUserId) || [];
          current.push(payload.candidate);
          pendingIceCandidatesRef.current.set(payload.fromUserId, current);
          return;
        }
        await pc.addIceCandidate(payload.candidate);
      } catch (err) {
        console.error('[voice] ice handling failed', err);
      }
    };

    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:answer', onAnswer);
    socket.on('webrtc:ice-candidate', onIceCandidate);

    return () => {
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice-candidate', onIceCandidate);
    };
  }, [isInChannel, backendToken, channelId, currentUser.id, connected]);

  useEffect(() => {
    if (!screenStream) {
      setScreenExpanded(false);
      return;
    }
    const id = setTimeout(() => setScreenExpanded(true), 20);
    return () => clearTimeout(id);
  }, [screenStream]);

  useEffect(() => {
    return () => {
      clearCameraRetryTimer();
      stopStream(cameraStreamRef.current);
      stopScreenShare(false);
      for (const remoteUserId of Array.from(peerConnectionsRef.current.keys())) {
        closePeerConnection(remoteUserId);
      }
      for (const remoteUserId of Array.from(remoteAudioElsRef.current.keys())) {
        removeRemoteAudioElement(remoteUserId);
      }
    };
  }, []);

  useEffect(() => {
    setBadgePulse(true);
    const id = setTimeout(() => setBadgePulse(false), 360);
    return () => clearTimeout(id);
  }, [voiceMember.muted, voiceMember.deafened]);

  useEffect(() => {
    if (!cameraStream) setCameraExpanded(false);
  }, [cameraStream]);

  useEffect(() => {
    if (!isInChannel || !audioInitialized || voiceMember.muted || voiceMember.deafened) {
      noiseFloorRef.current = 0.008;
      lastSpeechAtRef.current = 0;
      speakingStateChangedAtRef.current = 0;
      smoothedAudioLevelRef.current = 0;
      lastAudioLevelCommitAtRef.current = 0;
      setAudioLevel(0);
      setLocalSpeakingState(false);
      return;
    }
    const interval = window.setInterval(() => {
      const level = audioEngine.getAudioLevel();

      const now = performance.now();
      const prevFloor = noiseFloorRef.current;
      const nearSilence = level <= prevFloor + 0.005;
      const alpha = nearSilence ? 0.12 : 0.025;
      const nextFloor = Math.min(0.06, Math.max(0.0015, prevFloor * (1 - alpha) + level * alpha));
      noiseFloorRef.current = nextFloor;

      const speechDelta = Math.max(0, level - nextFloor);
      const uiTarget = Math.max(0, Math.min(1, speechDelta * 14));
      const uiLevel = smoothedAudioLevelRef.current * 0.72 + uiTarget * 0.28;
      smoothedAudioLevelRef.current = uiLevel;
      if (now - lastAudioLevelCommitAtRef.current >= 140) {
        lastAudioLevelCommitAtRef.current = now;
        setAudioLevel((prev) => (Math.abs(prev - uiLevel) < 0.02 ? prev : uiLevel));
      }

      const onDelta = 0.016;
      const offDelta = 0.006;
      const minStateChangeMs = 380;

      if (speechDelta >= onDelta) {
        lastSpeechAtRef.current = now;
        if (!localSpeakingRef.current && now - speakingStateChangedAtRef.current > minStateChangeMs) {
          speakingStateChangedAtRef.current = now;
          setLocalSpeakingState(true);
        }
        return;
      }

      const releaseGraceMs = 760;
      if (
        localSpeakingRef.current &&
        speechDelta <= offDelta &&
        now - lastSpeechAtRef.current > releaseGraceMs &&
        now - speakingStateChangedAtRef.current > minStateChangeMs
      ) {
        speakingStateChangedAtRef.current = now;
        setLocalSpeakingState(false);
      }
    }, 85);

    return () => window.clearInterval(interval);
  }, [audioInitialized, isInChannel, voiceMember.muted, voiceMember.deafened]);

  useEffect(() => {
    if (!isInChannel) return;
    const id = window.setInterval(() => {
      const now = performance.now();
      if (
        localSpeakingRef.current &&
        now - lastSpeechAtRef.current > 1800 &&
        now - speakingStateChangedAtRef.current > 320
      ) {
        speakingStateChangedAtRef.current = now;
        setLocalSpeakingState(false);
      }
    }, 260);
    return () => window.clearInterval(id);
  }, [isInChannel]);

  useEffect(() => {
    if (isInChannel) return;
    localSpeakingRef.current = false;
    speakingStateChangedAtRef.current = 0;
    smoothedAudioLevelRef.current = 0;
    lastAudioLevelCommitAtRef.current = 0;
    setAudioLevel(0);
    setSpeaking(channelId, currentUser.id, false);
  }, [isInChannel, channelId, currentUser.id, setSpeaking]);

  useEffect(() => {
    if (!isInChannel) {
      setLinkHealth('offline');
      return;
    }

    const evaluate = () => {
      const remoteUserIds = connected.filter((id) => id !== currentUser.id);
      if (remoteUserIds.length === 0) {
        setLinkHealth('stable');
        return;
      }

      let connectedCount = 0;
      let unstableCount = 0;
      for (const remoteUserId of remoteUserIds) {
        const pc = peerConnectionsRef.current.get(remoteUserId);
        if (!pc) {
          unstableCount += 1;
          continue;
        }
        const conn = pc.connectionState;
        const ice = pc.iceConnectionState;
        if (conn === 'connected' || ice === 'connected' || ice === 'completed') {
          connectedCount += 1;
          continue;
        }
        if (
          conn === 'failed' ||
          conn === 'disconnected' ||
          conn === 'closed' ||
          ice === 'failed' ||
          ice === 'disconnected' ||
          ice === 'closed'
        ) {
          unstableCount += 1;
          continue;
        }
      }

      if (unstableCount > 0) {
        setLinkHealth('unstable');
        return;
      }
      if (connectedCount === remoteUserIds.length) {
        setLinkHealth('stable');
        return;
      }
      setLinkHealth('connecting');
    };

    evaluate();
    const intervalId = window.setInterval(evaluate, 1200);
    return () => window.clearInterval(intervalId);
  }, [isInChannel, connected, currentUser.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase() || '';
      const isTypingTarget =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        Boolean(target?.isContentEditable);
      if (isTypingTarget) return;
      if (!isInChannel) return;

      const key = event.key.toLowerCase();
      if (key === 'm') {
        event.preventDefault();
        setVoiceMemberState(currentUser.id, { muted: !voiceMember.muted });
        return;
      }
      if (key === 'd') {
        event.preventDefault();
        setVoiceMemberState(currentUser.id, { deafened: !voiceMember.deafened });
        return;
      }
      if (key === 'c') {
        event.preventDefault();
        setCameraEnabled((value) => !value);
        return;
      }
      if (key === 's') {
        event.preventDefault();
        if (screenEnabled) {
          stopScreenShare();
        } else {
          void startScreenShare();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isInChannel, currentUser.id, voiceMember.muted, voiceMember.deafened, screenEnabled]);

  const members = useMemo(() => {
    const byId = new Map(users.map((u) => [u.id, u] as const));
    return connected
      .map((id) => {
        const primaryRole = getPrimaryMemberRole(activeServer || undefined, id);
        const rolePresentation = getRoleNamePresentation(primaryRole);
        const memberState = voiceMemberMap[id] || { muted: false, deafened: false };
        if (id === currentUser.id) {
          return {
            id,
            username: currentUser.username,
            avatar: currentUser.avatar || null,
            color: currentUser.bannerColor || '#7A1027',
            roleColor: getRoleSolidColor(primaryRole, currentUser.bannerColor || '#7A1027'),
            roleNameClassName: rolePresentation.className,
            roleNameStyle: rolePresentation.style as React.CSSProperties | undefined,
            isOwner: Boolean(activeServer && activeServer.ownerId === id),
            muted: memberState.muted,
            deafened: memberState.deafened,
          };
        }
        const u = byId.get(id);
        return {
          id,
          username: u?.username || 'Unknown',
          avatar: u?.avatar || null,
          color: u?.bannerColor || '#FFFFFF',
          roleColor: getRoleSolidColor(primaryRole, u?.bannerColor || '#FFFFFF'),
          roleNameClassName: rolePresentation.className,
          roleNameStyle: rolePresentation.style as React.CSSProperties | undefined,
          isOwner: Boolean(activeServer && activeServer.ownerId === id),
          muted: memberState.muted,
          deafened: memberState.deafened,
        };
      })
      .sort((a, b) => a.username.localeCompare(b.username));
  }, [connected, users, currentUser.id, currentUser.username, currentUser.avatar, currentUser.bannerColor, voiceMemberMap, activeServer]);

  const remoteVideoTiles = useMemo(
    () =>
      remoteVideoStreams.map((entry) => {
        const remoteUser = users.find((u) => u.id === entry.userId) || null;
        return {
          id: `remote:${entry.userId}`,
          stream: entry.stream,
          label: remoteUser?.username || 'Usuario remoto',
          isLocal: false,
        };
      }),
    [remoteVideoStreams, users]
  );

  const allCameraTiles = useMemo(() => {
    const localTile = cameraStream
      ? [
          {
            id: `local:${currentUser.id}`,
            stream: cameraStream,
            label: `${currentUser.username} (tu)`,
            isLocal: true,
          },
        ]
      : [];
    return [...remoteVideoTiles, ...localTile];
  }, [remoteVideoTiles, cameraStream, currentUser.id, currentUser.username]);

  return (
    <div className={cn(
      "flex-1 flex flex-col bg-[#0A0A0B] h-full overflow-hidden font-sans",
      hasVideo ? "isolate" : ""
    )}>
      {/* Top Header - Ultra Clean */}
      <div className={cn(
        "h-16 flex items-center px-8 border-b border-white/[0.03] bg-white/[0.01] flex-shrink-0",
        hasVideo ? "" : "backdrop-blur-xl"
      )}>
        <div className="flex items-center flex-1 gap-4">
          <div className="w-10 h-10 rounded-xl bg-neon-blue/10 flex items-center justify-center border border-neon-blue/20">
            <Signal size={20} className="text-neon-blue" />
          </div>
          <div>
            <h3 className="text-white font-black text-xl tracking-tight leading-none">{channelName}</h3>
            <div className="text-[10px] text-[#4E5058] uppercase tracking-[0.2em] font-black mt-1">Primary Uplink // Active</div>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div
            className={cn(
              "hidden md:flex items-center gap-2 px-4 py-2 rounded-full border",
              linkHealth === 'stable'
                ? "bg-neon-green/10 border-neon-green/25"
                : linkHealth === 'connecting'
                  ? "bg-neon-blue/10 border-neon-blue/25"
                  : linkHealth === 'unstable'
                    ? "bg-neon-pink/10 border-neon-pink/25"
                    : "bg-white/[0.03] border-white/[0.05]"
            )}
          >
            <Activity
              size={14}
              className={cn(
                linkHealth === 'stable'
                  ? "text-neon-green"
                  : linkHealth === 'connecting'
                    ? "text-neon-blue"
                    : linkHealth === 'unstable'
                      ? "text-neon-pink"
                      : "text-[#7b838a]"
              )}
            />
            <span className="text-[10px] font-bold text-[#B5BAC1] uppercase">
              {linkHealth === 'stable'
                ? 'Link estable'
                : linkHealth === 'connecting'
                  ? 'Conectando'
                  : linkHealth === 'unstable'
                    ? 'Link inestable'
                    : 'Sin enlace'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-neon-purple" />
            <span className="text-[10px] font-bold text-[#B5BAC1] uppercase">Encrypted</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-10 custom-scrollbar relative">
        {!hasVideo ? (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-neon-blue/5 blur-[120px] pointer-events-none rounded-full" />
        ) : null}

        <div className="max-w-6xl mx-auto h-full flex flex-col">
          <div className="flex items-end justify-between mb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-neon-blue/10 border border-neon-blue/20 text-neon-blue text-[10px] font-black uppercase tracking-widest mb-4">
                  Voz conectada
                </div>
              <p className="text-[#B5BAC1] text-lg max-w-xl font-medium leading-relaxed opacity-60">
                Conectado al vacio digital. Tu transmision esta activa. Mantiene espacio para hablar.
              </p>
            </div>

            <div className="flex flex-col items-end gap-4">
              <div className="text-right">
                <div className="text-[10px] font-black text-[#4E5058] uppercase tracking-widest mb-1">Estado del canal</div>
                <div className="text-2xl font-black text-white">
                  {connected.length} <span className="text-[#4E5058]">/ {channelUserLimit || 'INF'}</span>
                </div>
              </div>
              {isInChannel ? (
                <button
                  onClick={() => voiceLeave(channelId, currentUser.id)}
                  className="group px-8 py-4 rounded-2xl bg-neon-pink text-white font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-[0_0_30px_rgba(142,19,48,0.3)] flex items-center gap-3 text-sm"
                >
                  <LogOut size={20} />
                  Terminar conexion
                </button>
              ) : (
                <button
                  onClick={() => {
                    setVoiceMemberState(currentUser.id, { muted: false, deafened: false });
                    voiceJoin(channelId, currentUser.id);
                  }}
                  disabled={isChannelFull}
                  className="group px-10 py-5 rounded-2xl bg-white text-black font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-[0_0_40px_rgba(255,255,255,0.2)] flex items-center gap-3 text-base"
                >
                  <LogIn size={24} />
                  {isChannelFull ? 'Canal lleno' : 'Iniciar enlace'}
                </button>
              )}
            </div>
          </div>

          {isInChannel && (screenStream || cameraStream || remoteVideoTiles.length > 0) ? (
            <div className={cn("mb-10", hasVideo ? "[contain:paint]" : "")}>
              {screenStream ? (
                <div
                  className={cn(
                    "relative w-full overflow-hidden rounded-[32px] border border-white/[0.06] bg-white/[0.02] shadow-2xl",
                    "transition-[height] duration-500 ease-out",
                    screenExpanded ? "h-[560px]" : "h-[360px]",
                    "float-slow"
                  )}
                >
                  <div className="absolute inset-0">
                    <VideoTile
                      stream={screenStream}
                      label="Pantalla"
                      highlight
                      className="rounded-none border-0 shadow-none"
                      fit="contain"
                      aggressiveRecovery={false}
                      onFirstFrame={handleScreenFirstFrame}
                    />
                  </div>

                  <div className="absolute top-4 left-4 flex items-center gap-2">
                    <span className={cn(
                      "px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border",
                      screenStatus === 'live'
                        ? "bg-neon-green/10 text-neon-green border-neon-green/30"
                        : screenStatus === 'connecting'
                          ? "bg-neon-blue/10 text-neon-blue border-neon-blue/30"
                          : "bg-neon-pink/10 text-neon-pink border-neon-pink/30"
                    )}>
                      {screenStatus === 'live' ? 'Pantalla activa' : screenStatus === 'connecting' ? 'Conectando...' : 'Sin frames'}
                    </span>
                    {(screenStatus === 'stalled' || screenStatus === 'connecting') && (
                      <span className="px-2.5 py-1.5 rounded-full bg-white/8 border border-white/20 text-white/80 text-[10px] font-black uppercase tracking-[0.2em]">
                        {screenRetryCount > 0 ? `Reintentando ${screenRetryCount}/2` : 'Esperando stream'}
                      </span>
                    )}
                    {(screenStatus === 'stalled' || screenStatus === 'connecting') && (
                      <button
                        onClick={() => restartScreenShare()}
                        className="px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-white text-[10px] font-black uppercase tracking-[0.2em] hover:bg-white/15 transition-all inline-flex items-center gap-1.5"
                      >
                        <RefreshCw size={12} />
                        Reconectar
                      </button>
                    )}
                  </div>

                  {cameraStream ? (
                    <div className={cn(
                      "absolute bottom-5 left-5 md:left-auto md:right-5",
                      cameraExpanded ? "w-[360px] h-[220px] md:w-[420px] md:h-[260px]" : "w-[200px] h-[120px] md:w-[240px] md:h-[150px]",
                      "rounded-2xl overflow-hidden border border-white/10 bg-black/40",
                      "shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_60px_rgba(0,0,0,0.6)]",
                      "transition-all duration-500 ease-out",
                      screenExpanded ? "scale-100" : "scale-95"
                    )}>
                      <VideoTile
                        stream={cameraStream}
                        label={`${currentUser.username} (tu)`}
                        className="rounded-none border-0 shadow-none"
                        // force re-sync of camera video when screen stream toggles
                        videoKeyExtra={screenStream.id}
                        fit="contain"
                        onClick={() => setCameraExpanded((v) => !v)}
                        isExpanded={cameraExpanded}
                      />
                    </div>
                  ) : null}
                </div>
              ) : allCameraTiles.length > 0 ? (
                <div className={cn(
                  "mx-auto w-full transition-all duration-500 float-slow",
                  allCameraTiles.length > 1
                    ? "max-w-6xl"
                    : cameraExpanded
                      ? "max-w-5xl"
                      : "max-w-2xl"
                )}>
                  <div className={cn(
                    allCameraTiles.length > 1
                      ? "grid grid-cols-1 md:grid-cols-2 gap-4"
                      : "relative aspect-video"
                  )}>
                    {allCameraTiles.map((tile) => (
                      <div key={tile.id} className="relative aspect-video">
                        <VideoTile
                          stream={tile.stream}
                          label={tile.label}
                          fit="contain"
                          onClick={tile.isLocal && allCameraTiles.length === 1 ? () => setCameraExpanded((v) => !v) : undefined}
                          isExpanded={tile.isLocal ? cameraExpanded : false}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={cn(
            "flex-1 rounded-[28px] border border-white/[0.05] bg-white/[0.02] overflow-hidden",
            hasVideo ? "backdrop-blur-sm" : "backdrop-blur-md"
          )}>
            <div className="px-5 py-4 border-b border-white/[0.05] flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#7b838a] mb-1">Participantes</div>
                <div className="text-white font-black text-lg tracking-tight">{members.length} conectados</div>
              </div>
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-neon-blue">
                Voice Matrix
              </div>
            </div>

            {members.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center text-[#5c6169]">
                <Volume2 size={26} className="opacity-40 mb-3" />
                <p className="text-[11px] font-black uppercase tracking-[0.24em]">Awaiting signal</p>
              </div>
            ) : (
              <div className="p-3 max-h-[420px] overflow-y-auto custom-scrollbar space-y-2">
                {members.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "group rounded-2xl border px-3 py-2.5 flex items-center gap-3 transition-all duration-300",
                      speaking.has(m.id)
                        ? "border-[#F23F43]/50 bg-[#F23F43]/10 shadow-[0_0_20px_rgba(242,63,67,0.16)]"
                        : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/15"
                    )}
                  >
                    <div className="relative flex-shrink-0">
                      <div className={cn(
                        "w-11 h-11 rounded-full border-2 overflow-hidden",
                        speaking.has(m.id) ? "border-[#F23F43]" : "border-white/10"
                      )}>
                        {m.avatar ? (
                          <img src={m.avatar} alt={m.username} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-[#1E1F22] flex items-center justify-center text-base font-black text-white" style={{ color: m.roleColor }}>
                            {m.username[0]}
                          </div>
                        )}
                      </div>
                      <span
                        className={cn(
                          "absolute -right-0.5 -bottom-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#0A0A0B]",
                          speaking.has(m.id)
                            ? "bg-[#F23F43]"
                            : m.deafened
                              ? "bg-neon-purple"
                              : m.muted
                                ? "bg-neon-pink"
                                : "bg-neon-green"
                        )}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("truncate text-sm font-black text-white", m.roleNameClassName)} style={m.roleNameStyle}>
                          {m.username}
                        </span>
                        {m.isOwner ? <Crown size={12} className="text-yellow-400 flex-shrink-0" /> : null}
                      </div>
                      <div className={cn(
                        "text-[10px] font-black uppercase tracking-[0.2em]",
                        speaking.has(m.id) ? "text-[#F23F43]" : "text-[#7b838a]"
                      )}>
                        {speaking.has(m.id) ? 'Hablando ahora' : m.deafened ? 'Ensordecido' : m.muted ? 'Silenciado' : 'Escuchando'}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 text-white/80">
                      {speaking.has(m.id) ? (
                        <Volume2 size={15} />
                      ) : m.deafened ? (
                        <VolumeX size={15} className={cn(m.id === currentUser.id && badgePulse && "badge-pop")} />
                      ) : m.muted ? (
                        <MicOff size={15} className={cn(m.id === currentUser.id && badgePulse && "badge-pop")} />
                      ) : (
                        <Mic size={15} className={cn(m.id === currentUser.id && badgePulse && "badge-pop")} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {joinDeniedMessage ? (
        <div className="fixed bottom-8 right-8 z-[520] px-4 py-2 rounded-xl bg-[#0A0A0B]/95 border border-neon-pink/35 text-neon-pink font-black uppercase tracking-widest text-[10px] shadow-2xl">
          {joinDeniedMessage}
        </div>
      ) : null}

      <div className={cn(
        "px-12 py-8 border-t border-white/[0.03] bg-white/[0.01] flex items-center justify-between",
        hasVideo ? "" : "backdrop-blur-xl"
      )}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-2 h-2 rounded-full",
              isInChannel
                ? cn("bg-neon-green shadow-[0_0_10px_#00FF94]", !hasVideo && "animate-pulse")
                : "bg-[#F23F43]"
            )} />
            <span className={cn(
              "font-black text-xs uppercase tracking-widest",
              isInChannel ? "text-neon-green" : "text-[#F23F43]"
            )}>
              {isInChannel ? "Protocolo activo" : "Enlace caido"}
            </span>
          </div>

          {isInChannel && (
            <>
              <div className="h-10 w-px bg-white/5" />
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-[#4E5058] uppercase tracking-[0.3em] mb-2">Codigo de enlace</span>
                <span className="text-xs text-white font-mono opacity-80">AES-256 // VX-99</span>
                <span className="text-[9px] text-[#6b7280] font-black uppercase tracking-[0.14em] mt-1">
                  Ctrl+Shift+M/D/C/S
                </span>
              </div>
              {cameraEnabled ? (
                <>
                  <div className="h-10 w-px bg-white/5" />
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-[#4E5058] uppercase tracking-[0.3em] mb-2">Camara</span>
                    <span
                      className={cn(
                        "text-xs font-black uppercase tracking-[0.18em]",
                        cameraStatus === 'live'
                          ? 'text-neon-green'
                          : cameraStatus === 'connecting'
                            ? 'text-neon-blue'
                            : cameraStatus === 'stalled'
                              ? 'text-neon-pink'
                              : 'text-[#7b838a]'
                      )}
                    >
                      {cameraStatus === 'live'
                        ? 'Activa'
                        : cameraStatus === 'connecting'
                          ? 'Conectando'
                          : cameraStatus === 'stalled'
                            ? 'Reintentando'
                            : 'Inactiva'}
                      {cameraStatus === 'stalled' && cameraRetryCount > 0 ? ` (${cameraRetryCount}/2)` : ''}
                    </span>
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center gap-4">
          <button
            disabled={!isInChannel}
            onClick={() => setVoiceMemberState(currentUser.id, { muted: !voiceMember.muted })}
            className={cn(
              "w-16 h-16 rounded-[24px] border-2 flex items-center justify-center transition-all duration-500 transform active:scale-90 relative",
              !isInChannel
                ? "bg-white/[0.02] border-white/[0.05] text-[#4E5058] cursor-not-allowed"
                : voiceMember.muted
                  ? "bg-neon-pink/10 border-neon-pink text-neon-pink shadow-[0_0_30px_rgba(142,19,48,0.2)]"
                  : "bg-white/[0.03] border-white/10 text-white hover:border-neon-blue hover:text-neon-blue hover:bg-neon-blue/5"
            )}
            title="Toggle Microphone"
          >
            {/* Audio level indicator */}
            {isInChannel && !voiceMember.muted && audioLevel > 0.1 && (
              <div 
                className="absolute inset-0 rounded-[24px] border-2 border-neon-green/50 animate-pulse"
                style={{ opacity: Math.min(audioLevel, 1) }}
              />
            )}
            {voiceMember.muted ? <MicOff size={28} /> : <Mic size={28} />}
          </button>

          <button
            disabled={!isInChannel}
            onClick={() => setVoiceMemberState(currentUser.id, { deafened: !voiceMember.deafened })}
            className={cn(
              "w-16 h-16 rounded-[24px] border-2 flex items-center justify-center transition-all duration-500 transform active:scale-90",
              !isInChannel
                ? "bg-white/[0.02] border-white/[0.05] text-[#4E5058] cursor-not-allowed"
                : voiceMember.deafened
                  ? "bg-neon-purple/10 border-neon-purple text-neon-purple shadow-[0_0_30px_rgba(90,16,35,0.2)]"
                  : "bg-white/[0.03] border-white/10 text-white hover:border-neon-blue hover:text-neon-blue hover:bg-neon-blue/5"
            )}
            title="Toggle Deafen"
          >
            {voiceMember.deafened ? <EarOff size={28} /> : <Headphones size={28} />}
          </button>

          <button
            disabled={!isInChannel}
            onClick={() => setCameraEnabled(!cameraEnabled)}
            className={cn(
              "w-16 h-16 rounded-[24px] border-2 flex items-center justify-center transition-all duration-500 transform active:scale-90",
              !isInChannel
                ? "bg-white/[0.02] border-white/[0.05] text-[#4E5058] cursor-not-allowed"
                : cameraEnabled
                  ? "bg-neon-green/10 border-neon-green text-neon-green shadow-[0_0_30px_rgba(0,255,148,0.2)]"
                  : "bg-white/[0.03] border-white/10 text-white hover:border-neon-blue hover:text-neon-blue hover:bg-neon-blue/5"
            )}
            title="Toggle Camera"
          >
            {cameraEnabled ? <Video size={28} /> : <VideoOff size={28} />}
          </button>

          <button
            disabled={!isInChannel}
            onClick={() => {
              if (!isInChannel) return;
              if (screenEnabled) {
                stopScreenShare();
                return;
              }
              void startScreenShare();
            }}
            className={cn(
              "w-16 h-16 rounded-[24px] border-2 flex items-center justify-center transition-all duration-500 transform active:scale-90",
              !isInChannel
                ? "bg-white/[0.02] border-white/[0.05] text-[#4E5058] cursor-not-allowed"
                : screenEnabled
                  ? "bg-neon-purple/10 border-neon-purple text-neon-purple shadow-[0_0_30px_rgba(90,16,35,0.2)]"
                  : "bg-white/[0.03] border-white/10 text-white hover:border-neon-blue hover:text-neon-blue hover:bg-neon-blue/5"
            )}
            title="Toggle Screen Share"
          >
            {screenEnabled ? <MonitorX size={28} /> : <MonitorUp size={28} />}
          </button>

          <button
            disabled={!isInChannel}
            onClick={() => forceResyncPeers()}
            className={cn(
              "w-16 h-16 rounded-[24px] border-2 flex items-center justify-center transition-all duration-500 transform active:scale-90",
              !isInChannel
                ? "bg-white/[0.02] border-white/[0.05] text-[#4E5058] cursor-not-allowed"
                : "bg-white/[0.03] border-white/10 text-white hover:border-neon-blue hover:text-neon-blue hover:bg-neon-blue/5"
            )}
            title="Resincronizar video y audio"
          >
            <RefreshCw size={24} />
          </button>
        </div>
      </div>
    </div>
  );
};


