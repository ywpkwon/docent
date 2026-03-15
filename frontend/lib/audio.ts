/**
 * Audio utilities for the voice controller.
 *
 * Capture: getUserMedia → AudioWorklet (downsample to 16kHz PCM int16) → WebSocket
 * Playback: base64 PCM (24kHz int16) ← WebSocket → AudioContext queue → speaker
 */

export class MicCapture {
  private context: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private onChunk: (pcmBase64: string) => void;

  constructor(onChunk: (pcmBase64: string) => void) {
    this.onChunk = onChunk;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Try to get 16kHz context; fall back to default (we'll resample manually)
    this.context = new AudioContext({ sampleRate: 16000 });

    await this.context.audioWorklet.addModule("/worklets/mic-processor.js");

    this.sourceNode = this.context.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.context, "mic-processor");

    this.workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const pcmBase64 = arrayBufferToBase64(e.data);
      this.onChunk(pcmBase64);
    };

    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.context.destination);
  }

  stop(): void {
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.context?.close();
    this.context = null;
    this.workletNode = null;
    this.sourceNode = null;
    this.stream = null;
  }
}


export class AudioPlayer {
  private context: AudioContext;
  private queue: AudioBuffer[] = [];
  private playing = false;
  private nextStartTime = 0;

  constructor() {
    // Gemini Live API returns 24kHz audio
    this.context = new AudioContext({ sampleRate: 24000 });
  }

  enqueue(pcmBase64: string): void {
    const arrayBuffer = base64ToArrayBuffer(pcmBase64);
    const int16 = new Int16Array(arrayBuffer);
    const float32 = int16ToFloat32(int16);

    const buffer = this.context.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0);
    this.queue.push(buffer);

    if (!this.playing) {
      this.playNext();
    }
  }

  private playNext(): void {
    if (this.queue.length === 0) {
      this.playing = false;
      return;
    }

    this.playing = true;
    const buffer = this.queue.shift()!;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    const now = this.context.currentTime;
    const startAt = Math.max(now, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    source.onended = () => this.playNext();
  }

  interrupt(): void {
    this.queue.length = 0;
    this.playing = false;
    this.nextStartTime = 0;
    // Resume context in case it was suspended
    if (this.context.state === "suspended") {
      this.context.resume();
    }
  }

  close(): void {
    this.interrupt();
    this.context.close();
  }
}


function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const uint8 = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const uint8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    uint8[i] = binary.charCodeAt(i);
  }
  return uint8.buffer;
}

function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}
