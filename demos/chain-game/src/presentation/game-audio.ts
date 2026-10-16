/** Short, locally synthesized effects; no music, network requests or game RNG. */
export interface TurnAudio {
  slash(speed: number, heavy: boolean): void;
  gemPickup(value: number): void;
  gemLand(value: number): void;
  hurt(): void;
  shield?(): void;
  stop(): void;
}

export class GameAudio implements TurnAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Set<AudioBufferSourceNode>();
  private countBuffer: AudioBuffer | null = null;
  private slashBuffer: AudioBuffer | null = null;
  private pickupBuffer: AudioBuffer | null = null;
  private landingBuffer: AudioBuffer | null = null;
  private hurtBuffer: AudioBuffer | null = null;
  private shieldBuffer: AudioBuffer | null = null;

  /** Must be called directly from a pointer/key gesture (including mobile). */
  unlock(): void {
    try {
      if (this.context?.state === 'closed') {
        this.stop();
        this.context = null;
        this.master = null;
        this.countBuffer = null;
        this.slashBuffer = null;
        this.pickupBuffer = null;
        this.landingBuffer = null;
        this.hurtBuffer = null;
        this.shieldBuffer = null;
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
        const pickupFrequencies = [1050, 1312.5, 1575];
        this.pickupBuffer = this.createBuffer(0.28, (t) => {
          // A bright three-note crystal pickup, separate from the route ticks.
          let chime = 0;
          for (let note = 0; note < 3; note += 1) {
            const age = t - note * 0.035;
            if (age < 0) continue;
            const frequency = pickupFrequencies[note];
            const phase = 2 * Math.PI * frequency * age;
            chime += Math.min(1, age / 0.002) * Math.exp(-age * 24) *
              (Math.sin(phase) * 0.27 + Math.sin(phase * 2.4) * 0.065);
          }
          return chime;
        });
        let landingNoise = 0;
        let landingRandom = 0x7a31;
        this.landingBuffer = this.createBuffer(0.32, (t) => {
          // A weighty thud and a short crystal rattle start on the impact frame.
          landingRandom = (Math.imul(landingRandom, 1664525) + 1013904223) >>> 0;
          const noise = landingRandom / 0x80000000 - 1;
          landingNoise += (noise - landingNoise) * 0.24;
          const attack = Math.min(1, t / 0.0015);
          const thud = Math.sin(2 * Math.PI * (135 * t - 105 * t * t)) *
            Math.exp(-t * 30) * 0.62;
          const crunch = landingNoise * Math.exp(-t * 43) * 0.64;
          const crystal = (Math.sin(2 * Math.PI * 1680 * t) +
            Math.sin(2 * Math.PI * 2390 * t) * 0.55) * Math.exp(-t * 22) * 0.1;
          return attack * (thud + crunch + crystal);
        });
        let hurtNoise = 0;
        let hurtRandom = 0x3d8f;
        this.hurtBuffer = this.createBuffer(0.21, (t) => {
          // A muffled downward impact and dry crack distinguish damage from blade/crystal sounds.
          hurtRandom = (Math.imul(hurtRandom, 1664525) + 1013904223) >>> 0;
          const noise = hurtRandom / 0x80000000 - 1;
          hurtNoise += (noise - hurtNoise) * 0.14;
          const attack = Math.min(1, t / 0.001);
          const bodyPhase = 2 * Math.PI * (195 * t - 295 * t * t);
          const body = (Math.sin(bodyPhase) * 0.63 +
            Math.sin(bodyPhase * 0.5) * 0.22) * Math.exp(-t * 22);
          const crack = (noise - hurtNoise) * Math.exp(-t * 105) * 0.26;
          const grit = hurtNoise * Math.exp(-t * 38) * 0.42;
          return attack * (body + crack + grit);
        });
        this.shieldBuffer = this.createBuffer(0.32, (t) => {
          // Inharmonic partials give the one-turn block a bright metallic clang.
          const attack = Math.min(1, t / 0.0012);
          const clang = Math.sin(2 * Math.PI * 680 * t) * Math.exp(-t * 23) * 0.46 +
            Math.sin(2 * Math.PI * 1171 * t) * Math.exp(-t * 31) * 0.23 +
            Math.sin(2 * Math.PI * 1837 * t) * Math.exp(-t * 41) * 0.15;
          const crack = Math.sin(2 * Math.PI * (3100 * t - 3500 * t * t)) *
            Math.exp(-t * 90) * 0.18;
          return attack * (clang + crack);
        });
      }
      if (this.context.state !== 'running' && this.context.state !== 'closed')
        void this.context.resume().catch(() => {});
    } catch {
      // Audio availability never gates input, persistence or animation.
    }
  }

  count(chainCount: number): void {
    // Ascending notes retain the count feeling without becoming piercing on long chains.
    const semitones = Math.min(19, Math.max(0, chainCount - 1) * 0.85);
    this.play(this.countBuffer, 2 ** (semitones / 12), 0.65);
  }

  slash(speed: number, heavy: boolean): void {
    // Impact stays on the authored contact frame; only timbre follows acceleration.
    const rate = (heavy ? 0.86 : 1) * (0.94 + Math.min(1, speed) * 0.12);
    this.play(this.slashBuffer, rate, heavy ? 0.92 : 0.8);
  }

  gemPickup(value: number): void {
    // Stack value changes the timbre slightly; a stack is picked up only once.
    const rate = 1 + Math.min(4, Math.max(0, value - 1)) * 0.025;
    this.play(this.pickupBuffer, rate, 0.85);
  }

  gemLand(value: number): void {
    const rate = 1 - Math.min(4, Math.max(0, value - 1)) * 0.035;
    this.play(this.landingBuffer, rate, 1);
  }

  hurt(): void {
    this.play(this.hurtBuffer, 1, 1);
  }

  shield(): void {
    this.play(this.shieldBuffer, 1, 0.95);
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
