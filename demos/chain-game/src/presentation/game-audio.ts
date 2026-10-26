/** Short, locally synthesized effects; no music, network requests or game RNG. */
const ARCADE_COUNT_RATIOS = [
  1, 1.12246, 1.25992, 1.49831, 1.68179,
  2, 2.24492, 2.51984, 2.99661, 3.36359,
] as const;
const ARCADE_SLASH_CONTACT_SECONDS = 0.105;

function slashRate(speed: number, heavy: boolean): number {
  return (heavy ? 0.86 : 1) * (0.94 + Math.min(1, speed) * 0.12);
}

/** Call the slash buffer this far before the authored contact frame. */
export function slashLeadSeconds(speed: number, heavy: boolean): number {
  return ARCADE_SLASH_CONTACT_SECONDS / slashRate(speed, heavy);
}

export interface TurnAudio {
  slash(speed: number, heavy: boolean): void;
  gemPickup(value: number): void;
  gemLand(value: number): void;
  hurt(): void;
  death(): void;
  shield?(): void;
  stop(): void;
}

interface PendingVoice {
  buffer: AudioBuffer;
  rate: number;
  volume: number;
  queuedAt: number;
}

export class GameAudio implements TurnAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Set<AudioBufferSourceNode>();
  private pendingVoices: PendingVoice[] = [];
  private resumePending = false;
  private outputReadyAt = 0;
  private countBuffers: AudioBuffer[] = [];
  private slashBuffer: AudioBuffer | null = null;
  private pickupBuffer: AudioBuffer | null = null;
  private landingBuffer: AudioBuffer | null = null;
  private hurtBuffer: AudioBuffer | null = null;
  private deathBuffer: AudioBuffer | null = null;
  private shieldBuffer: AudioBuffer | null = null;

  /** Must be called directly from a pointer/key gesture (including mobile). */
  unlock(): void {
    try {
      if (this.context?.state === 'closed') {
        this.stop();
        this.context = null;
        this.master = null;
        this.pendingVoices = [];
        this.resumePending = false;
        this.outputReadyAt = 0;
        this.countBuffers = [];
        this.slashBuffer = null;
        this.pickupBuffer = null;
        this.landingBuffer = null;
        this.hurtBuffer = null;
        this.deathBuffer = null;
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
        this.outputReadyAt = context.currentTime + 0.04;
        // Resume while the initiating gesture is still active, before buffer synthesis.
        this.resumeContext();
        this.primeOutput();
        const rawCountBuffers = ARCADE_COUNT_RATIOS.map((ratio, step) => {
          let countNoiseState = 0;
          let countRandomState = (0x3a91 + step * 0x9e37) >>> 0;
          return this.createBuffer(0.18, (t) => {
            // A "arcade rush": bright pluck, upper partial and sub-octave chip.
            countRandomState = (Math.imul(countRandomState, 1664525) + 1013904223) >>> 0;
            const noise = countRandomState / 0x80000000 - 1;
            countNoiseState += (noise - countNoiseState) * 0.18;
            const attack = Math.min(1, t / 0.0012);
            const phase = 2 * Math.PI * 640 * ratio * t;
            return attack * (
              Math.sin(phase) * Math.exp(-t * 42) +
              Math.sin(phase * 2.03) * Math.exp(-t * 70) * 0.42 +
              Math.sin(phase * 0.5) * Math.exp(-t * 26) * 0.2 +
              noise * Math.exp(-t * 145) * 0.24
            );
          });
        });
        const countGain = this.gainForPeak(rawCountBuffers, 0.89);
        this.countBuffers = rawCountBuffers.map((buffer) =>
          this.shapeBuffer(buffer, countGain),
        );
        let slashLowState = 0;
        let slashAirState = 0;
        let slashRandomState = 0x6c2d;
        this.slashBuffer = this.createBuffer(0.64, (t) => {
          // A "arcade rush": high-speed whoosh, rising chirp and a dry impact.
          slashRandomState = (Math.imul(slashRandomState, 1664525) + 1013904223) >>> 0;
          const noise = slashRandomState / 0x80000000 - 1;
          slashLowState += (noise - slashLowState) * 0.19;
          slashAirState += (noise - slashAirState) * 0.5;
          const contact = ARCADE_SLASH_CONTACT_SECONDS;
          const rise = Math.min(1, t / contact);
          const whoosh = (noise - slashLowState) * rise * rise * (1 - rise) * 0.8;
          const chirp = Math.sin(2 * Math.PI * (920 + 4600 * rise) * t) *
            (1 - rise) * 0.18;
          const impactAge = t - contact;
          if (impactAge < 0) return whoosh + chirp;
          const hit = (
            Math.sin(2 * Math.PI * 118 * impactAge) * 0.68 +
            Math.sin(2 * Math.PI * 240 * impactAge) * 0.28
          ) * Math.exp(-impactAge * 27) +
            (slashAirState - slashLowState) * Math.exp(-impactAge * 38) * 0.64;
          return whoosh + chirp + hit;
        });
        this.slashBuffer = this.shapeBuffer(
          this.slashBuffer,
          this.gainForPeak([this.slashBuffer], 0.89),
        );
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
        this.deathBuffer = this.createBuffer(0.68, (t) => {
          // A descending airy fall ends in a hollow wooden collapse.
          const fallPhase = 2 * Math.PI * (210 * t - 118 * t * t);
          const fall = Math.sin(fallPhase) * Math.exp(-t * 4.2) * 0.34;
          const collapseAge = t - 0.38;
          const collapse = collapseAge < 0
            ? 0
            : (Math.sin(2 * Math.PI * 64 * collapseAge) +
                Math.sin(2 * Math.PI * 96 * collapseAge) * 0.38) *
              Math.exp(-collapseAge * 10) * 0.66;
          return fall + collapse;
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
    } catch {
      // Audio availability never gates input, persistence or animation.
    }
  }

  count(chainCount: number): void {
    // A uses a bright pentatonic climb and caps the rate for long chains.
    const index = Math.min(ARCADE_COUNT_RATIOS.length - 1, Math.max(0, chainCount - 1));
    this.play(this.countBuffers[index], 1, index === 0 ? 0.92 : 0.78);
  }

  slash(speed: number, heavy: boolean): void {
    // Impact stays on the authored contact frame; only timbre follows acceleration.
    this.play(this.slashBuffer, slashRate(speed, heavy), heavy ? 0.86 : 0.92);
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

  death(): void {
    this.play(this.deathBuffer, 1, 0.92);
  }

  shield(): void {
    this.play(this.shieldBuffer, 1, 0.95);
  }

  stop(): void {
    this.pendingVoices = [];
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

  private gainForPeak(buffers: readonly AudioBuffer[], peak: number): number {
    let top = 0;
    for (const buffer of buffers)
      for (const sample of buffer.getChannelData(0))
        top = Math.max(top, Math.abs(sample));
    return top === 0 ? 1 : peak / top;
  }

  /** Match the normalized A1 preview and retain the same waveform proportions. */
  private shapeBuffer(buffer: AudioBuffer, gain: number): AudioBuffer {
    const data = buffer.getChannelData(0);
    const saturation = Math.tanh(1.18);
    for (let index = 0; index < data.length; index += 1)
      data[index] = Math.tanh(data[index] * gain * 1.18) / saturation;
    return buffer;
  }

  private play(buffer: AudioBuffer | null, rate: number, volume: number): void {
    const context = this.context;
    if (!context || context.state === 'closed' || !this.master || !buffer || document.hidden) return;
    if (context.state !== 'running') {
      this.pendingVoices.push({ buffer, rate, volume, queuedAt: performance.now() });
      if (this.pendingVoices.length > 16) this.pendingVoices.shift();
      this.resumeContext();
      return;
    }
    this.flushPendingVoices();
    this.startVoice(buffer, rate, volume);
  }

  private resumeContext(): void {
    const context = this.context;
    if (!context || context.state === 'closed') return;
    if (context.state === 'running') {
      this.flushPendingVoices();
      return;
    }
    if (this.resumePending) return;
    this.resumePending = true;
    void context.resume().then(() => {
      this.resumePending = false;
      this.outputReadyAt = context.currentTime + 0.04;
      this.flushPendingVoices();
    }).catch(() => {
      this.resumePending = false;
      this.pendingVoices = [];
    });
  }

  private primeOutput(): void {
    const context = this.context;
    if (!context || !this.master) return;
    try {
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, context.sampleRate);
      source.connect(this.master);
      source.start();
    } catch { /* The first real voice will report availability. */ }
  }

  private flushPendingVoices(): void {
    if (!this.context || this.context.state !== 'running' || !this.master) return;
    const now = performance.now();
    const pending = this.pendingVoices.splice(0);
    let replayIndex = 0;
    for (const voice of pending) {
      // Only flush from the gesture that created them, never a stale sound later.
      if (now - voice.queuedAt <= 750)
        this.startVoice(voice.buffer, voice.rate, voice.volume, replayIndex++ * 0.01);
    }
  }

  private startVoice(
    buffer: AudioBuffer,
    rate: number,
    volume: number,
    delaySeconds = 0,
  ): void {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.master) return;
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
      source.start(Math.max(context.currentTime + delaySeconds, this.outputReadyAt));
    } catch { /* An interrupted audio device must not interrupt a route. */ }
  }
}
