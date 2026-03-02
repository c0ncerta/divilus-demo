/**
 * High-Quality Audio Engine for Voice Calls
 * Includes WebRTC, Web Audio API optimization for maximum audio clarity
 */

type AudioQualityProfile = 'balanced' | 'clarity' | 'extreme';

interface AudioConfig {
  sampleRate: number;
  channelCount: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  bitRate: number;
  codec: string;
  qualityProfile: AudioQualityProfile;
  highPassHz: number;
  compressorEnabled: boolean;
}

interface AudioInitOptions {
  profile?: AudioQualityProfile;
  inputDeviceId?: string | null;
  microphoneVolume?: number;
}

class AudioEngine {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private highPassNode: BiquadFilterNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private mediaStreamAudioSourceNode: MediaStreamAudioSourceNode | null = null;
  private localStream: MediaStream | null = null;
  private outboundStream: MediaStream | null = null;
  private config: AudioConfig = {
    sampleRate: 48000, // 48kHz for high quality
    channelCount: 2, // Stereo
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
    bitRate: 192000,
    codec: 'opus', // Best codec for voice
    qualityProfile: 'clarity',
    highPassHz: 70,
    compressorEnabled: true,
  };

  private async resumeContextIfNeeded(): Promise<void> {
    if (!this.audioContext) return;
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch {}
    }
  }

  private buildTrackConstraints(inputDeviceId?: string | null): MediaTrackConstraints {
    const isExtreme = this.config.qualityProfile === 'extreme';
    return {
      sampleRate: { ideal: this.config.sampleRate },
      channelCount: { ideal: this.config.channelCount },
      echoCancellation: this.config.echoCancellation,
      noiseSuppression: this.config.noiseSuppression,
      autoGainControl: this.config.autoGainControl,
      sampleSize: { ideal: 24 },
      ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
      ...(isExtreme
        ? {
            latency: { ideal: 0.005 },
            advanced: [
              { suppressLocalAudioPlayback: false } as any,
              { voiceIsolation: false } as any,
            ],
          }
        : {
            latency: { ideal: 0.02 },
            advanced: [
              { suppressLocalAudioPlayback: false } as any,
              { voiceIsolation: true } as any,
            ],
          }),
    };
  }

  setQualityProfile(profile: AudioQualityProfile): void {
    if (profile === 'extreme') {
      this.config = {
        ...this.config,
        qualityProfile: 'extreme',
        sampleRate: 48000,
        channelCount: 2,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        bitRate: 256000,
        codec: 'opus',
        highPassHz: 60,
        compressorEnabled: false,
      };
      return;
    }

    if (profile === 'clarity') {
      this.config = {
        ...this.config,
        qualityProfile: 'clarity',
        sampleRate: 48000,
        channelCount: 2,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        bitRate: 192000,
        codec: 'opus',
        highPassHz: 70,
        compressorEnabled: true,
      };
      return;
    }

    this.config = {
      ...this.config,
      qualityProfile: 'balanced',
      sampleRate: 48000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      bitRate: 128000,
      codec: 'opus',
      highPassHz: 80,
      compressorEnabled: true,
    };
  }

  /**
   * Initialize audio context and get user audio stream
   */
  async initialize(options?: AudioQualityProfile | AudioInitOptions): Promise<MediaStream> {
    try {
      const normalized: AudioInitOptions =
        typeof options === 'string' ? { profile: options } : options || {};
      if (normalized.profile) this.setQualityProfile(normalized.profile);

      this.stop();

      // Create high-quality audio context
      const audioContextOptions = {
        sampleRate: this.config.sampleRate,
        latencyHint: 'interactive' as const,
      };
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)(audioContextOptions);
      await this.resumeContextIfNeeded();

      // Request microphone access with high-quality constraints + fallback
      const primaryConstraints = this.buildTrackConstraints(normalized.inputDeviceId);
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: primaryConstraints, video: false });
      const [track] = this.localStream.getAudioTracks();
      if (track) {
        try {
          (track as any).contentHint = this.config.qualityProfile === 'extreme' ? 'music' : 'speech';
        } catch {}
        try {
          await track.applyConstraints(primaryConstraints as MediaTrackConstraints);
        } catch {}
      }

      // Setup audio nodes
      this.setupAudioNodes(this.localStream);
      await this.resumeContextIfNeeded();
      if (typeof normalized.microphoneVolume === 'number') {
        this.setMicrophoneVolume(normalized.microphoneVolume);
      }

      return this.localStream;
    } catch (error) {
      // Fallback profile for stricter browsers/devices
      try {
        this.setQualityProfile('balanced');
        const fallbackConstraints = this.buildTrackConstraints(undefined);
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: fallbackConstraints, video: false });
        this.setupAudioNodes(this.localStream);
        await this.resumeContextIfNeeded();
        const normalized: AudioInitOptions =
          typeof options === 'string' ? { profile: options } : options || {};
        if (typeof normalized.microphoneVolume === 'number') {
          this.setMicrophoneVolume(normalized.microphoneVolume);
        }
        return this.localStream;
      } catch (fallbackError) {
        console.error('Failed to initialize audio:', fallbackError);
        throw fallbackError;
      }
    }
  }

  /**
   * Setup Web Audio API nodes for processing
   */
  private setupAudioNodes(stream: MediaStream): void {
    if (!this.audioContext) return;

    // Create source from media stream
    this.mediaStreamAudioSourceNode = this.audioContext.createMediaStreamSource(stream);

    // Create analyser for level detection
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.75;

    // Create gain node for volume control
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0;

    this.highPassNode = this.audioContext.createBiquadFilter();
    this.highPassNode.type = 'highpass';
    this.highPassNode.frequency.value = this.config.highPassHz;

    this.compressorNode = this.audioContext.createDynamicsCompressor();
    if (this.config.qualityProfile === 'clarity') {
      this.compressorNode.threshold.value = -22;
      this.compressorNode.knee.value = 14;
      this.compressorNode.ratio.value = 2.4;
      this.compressorNode.attack.value = 0.003;
      this.compressorNode.release.value = 0.12;
    } else {
      this.compressorNode.threshold.value = -20;
      this.compressorNode.knee.value = 20;
      this.compressorNode.ratio.value = 4;
      this.compressorNode.attack.value = 0.005;
      this.compressorNode.release.value = 0.16;
    }
    this.destinationNode = this.audioContext.createMediaStreamDestination();

    // Connect graph with profile-aware processing
    this.mediaStreamAudioSourceNode.connect(this.highPassNode);
    if (this.config.compressorEnabled) {
      this.highPassNode.connect(this.compressorNode);
      this.compressorNode.connect(this.gainNode);
    } else {
      this.highPassNode.connect(this.gainNode);
    }
    this.gainNode.connect(this.analyser);
    this.gainNode.connect(this.destinationNode);

    const outputTrack = this.destinationNode.stream.getAudioTracks()[0] || null;
    this.outboundStream = outputTrack ? new MediaStream([outputTrack]) : this.localStream;
  }

  /**
   * Get the current audio level (0-1)
   */
  getAudioLevel(): number {
    if (!this.analyser) return 0;
    if (this.audioContext?.state === 'suspended') {
      void this.resumeContextIfNeeded();
      return 0;
    }

    const size = this.analyser.fftSize;
    if (!size || size <= 0) return 0;
    const dataArray = new Uint8Array(size);
    this.analyser.getByteTimeDomainData(dataArray);

    // RMS over time-domain signal gives more stable speech detection than
    // averaging frequency bins across the full spectrum.
    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i += 1) {
      const centered = (dataArray[i] - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);
    return Math.max(0, Math.min(1, rms));
  }

  /**
   * Set microphone volume (0-1)
   */
  setMicrophoneVolume(volume: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Get microphone volume
   */
  getMicrophoneVolume(): number {
    return this.gainNode?.gain.value ?? 1;
  }

  /**
   * Get current local microphone stream
   */
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  /**
   * Get processed outbound stream used for WebRTC upload.
   */
  getOutboundStream(): MediaStream | null {
    const outboundTrack = this.outboundStream?.getAudioTracks()?.[0];
    if (outboundTrack && outboundTrack.readyState === 'live') return this.outboundStream;
    const localTrack = this.localStream?.getAudioTracks()?.[0];
    if (localTrack && localTrack.readyState === 'live') return this.localStream;
    return this.outboundStream || this.localStream;
  }

  /**
   * Get the underlying AudioContext (e.g. for autoplay resume).
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * Get audio configuration
   */
  getConfig(): AudioConfig {
    return { ...this.config };
  }

  /**
   * Update audio configuration
   */
  updateConfig(partial: Partial<AudioConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * Stop audio stream and cleanup
   */
  stop(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    if (this.outboundStream) {
      this.outboundStream.getTracks().forEach(track => track.stop());
      this.outboundStream = null;
    }

    this.mediaStreamAudioSourceNode = null;
    this.analyser = null;
    this.gainNode = null;
    this.compressorNode = null;
    this.highPassNode = null;
    this.destinationNode = null;

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Get audio stats for debugging
   */
  getStats() {
    const track = this.localStream?.getAudioTracks()?.[0];
    const outboundTrack = this.getOutboundStream()?.getAudioTracks()?.[0];
    const trackSettings = track?.getSettings ? track.getSettings() : null;
    const outboundSettings = outboundTrack?.getSettings ? outboundTrack.getSettings() : null;
    return {
      sampleRate: this.audioContext?.sampleRate,
      state: this.audioContext?.state,
      level: this.getAudioLevel(),
      volume: this.getMicrophoneVolume(),
      config: this.config,
      trackSettings,
      outboundSettings,
    };
  }
}

// Export singleton instance
export const audioEngine = new AudioEngine();
