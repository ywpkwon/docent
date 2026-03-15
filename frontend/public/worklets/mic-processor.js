/**
 * AudioWorklet processor: converts float32 audio to int16 PCM chunks
 * and posts them back to the main thread.
 *
 * Target: 16kHz mono (the AudioContext should already be at 16kHz,
 * so no resampling needed here).
 */
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    // Send chunks every ~100ms → at 16kHz = 1600 samples
    this._chunkSize = 1600;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0]; // Float32Array, mono
    for (let i = 0; i < samples.length; i++) {
      this._buffer.push(samples[i]);
    }

    while (this._buffer.length >= this._chunkSize) {
      const chunk = this._buffer.splice(0, this._chunkSize);
      const int16 = float32ToInt16(chunk);
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true;
  }
}

function float32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

registerProcessor("mic-processor", MicProcessor);
