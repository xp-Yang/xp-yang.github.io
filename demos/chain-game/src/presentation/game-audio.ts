/** Short, locally synthesized effects; no music, network requests or game RNG. */
export interface TurnAudio {
  slash(speed: number, heavy: boolean): void;
  stop(): void;
}

export class GameAudio implements TurnAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Set<AudioBufferSourceNode>();
  private countBuffer: AudioBuffer | null = null;
  private slashBuffer: AudioBuffer | null = null;

  /** Must be called directly from a pointer/key gesture (including mobile). */
  unlock(): void {
    try {
      if (this.context?.state === 'closed') {
        this.stop();
        this.context = null;
        this.master = null;
        this.countBuffer = null;
        this.slashBuffer = null;
      }
      if (!this.context) {
        const Constructor = window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Constructor) return;
        const context = new Constructor({ latencyHint: 'interactive' });
        this.context = context;
        this.master = context.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(context.destination);
        this.countBuffer = this.createBuffer(0.135, (t) => {
          // A rounded wooden/plucked tick, with a bright but short attack.
          const fundamental = 610;
          const phase = 2 * Math.PI * fundamental * t;
          const attack = Math.min(1, t / 0.0018);
          return attack * (
            Math.sin(phase) * Math.exp(-t * 37) * 0.48 +
            Math.sin(phase * 2.76) * Math.exp(-t * 73) * 0.19 +
            Math.sin(phase * 5.4) * Math.exp(-t * 130) * 0.08
          );
        });
        let previousNoise = 0;
        let randomState = 0x5a17;
        this.slashBuffer = this.createBuffer(0.185, (t) => {
          // Deterministic noise avoids consuming either gameplay random stream.
          randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
          const noise = randomState / 0x80000000 - 1;
          const high = noise - previousNoise * 0.72;
          previousNoise = noise;
          const envelope = Math.min(1, t / 0.0015) * Math.exp(-t * 37);
          const body = Math.sin(2 * Math.PI * (170 * t - 310 * t * t));
          return (high * 0.34 + body * Math.exp(-t * 50) * 0.48) * envelope;
        });
      }
      if (this.context.state !== 'running' && this.context.state !== 'closed')
        void this.context.resume().catch(() => {});
    } catch {
      // Audio availability never gates input, persistence or animation.
    }
  }

  count(fruitCount: number): void {
    // Ascending notes retain the count feeling without becoming piercing on long chains.
    const semitones = Math.min(19, Math.max(0, fruitCount - 1) * 0.85);
    this.play(this.countBuffer, 2 ** (semitones / 12), 0.65);
  }

  slash(speed: number, heavy: boolean): void {
    // Impact stays on the authored contact frame; only timbre follows acceleration.
    const rate = (heavy ? 0.86 : 1) * (0.94 + Math.min(1, speed) * 0.12);
    this.play(this.slashBuffer, rate, heavy ? 0.92 : 0.8);
  }

  stop(): void {
    for (const source of this.voices) {
      try { source.stop(); } catch { /* Already ended. */ }
    }
    this.voices.clear();
  }

  private createBuffer(duration: number, sample: (time: number) => number): AudioBuffer {
    const context = this.context!;
    const buffer = context.createBuffer(1, Math.ceil(duration * context.sampleRate), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const tail = Math.min(1, (data.length - 1 - i) / (context.sampleRate * 0.008));
      data[i] = sample(i / context.sampleRate) * tail;
    }
    return buffer;
  }

  private play(buffer: AudioBuffer | null, rate: number, volume: number): void {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.master || !buffer || document.hidden) return;
    try {
      // Bound polyphony for very fast pointer motion, while allowing short tails.
      if (this.voices.size >= 12) {
        const oldest = this.voices.values().next().value;
        oldest?.stop();
        if (oldest) this.voices.delete(oldest);
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(this.master);
      source.onended = () => {
        this.voices.delete(source);
        source.disconnect();
        gain.disconnect();
      };
      this.voices.add(source);
      source.start();
    } catch { /* An interrupted audio device must not interrupt a route. */ }
  }
}
