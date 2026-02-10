/**
 * Sound effects utility for UI interactions.
 *
 * Uses Web Audio API for low-latency playback with automatic pitch variation
 * for organic, non-robotic feel. Lazy-initializes on first user interaction.
 *
 * Usage:
 *   sounds.play("mint");
 *   sounds.play("select", { volume: 0.2 });
 *   sounds.play("hover", { spatial: true }); // use mouse position
 *   sounds.play("pop", { spatial: 300 }); // explicit X position
 */

import { useCallback, useSyncExternalStore } from "react";

/* ────────────────────────────
   Types
──────────────────────────── */

type PlayOptions = {
  /** Base volume (0-1). Default: 0.25 */
  volume?: number;
  /** Base pitch multiplier. Random variation (±9%) added automatically. Default: 1.0 */
  pitch?: number;
  /**
   * Spatial audio positioning:
   * - `true` → use current mouse position
   * - `number` → use explicit X coordinate (pixels from left edge)
   * - `undefined` → centered (no panning)
   */
  spatial?: boolean | number;
  /** Duration in seconds to play before fade out. If omitted, plays full sound. */
  duration?: number;
};

export type SoundGroup = "ambient" | "ui" | "feedback" | "critical";

export type SoundSceneOptions = {
  group?: SoundGroup;
  /** Higher = more important. Sounds with priority > 0 duck lower-priority groups. */
  priority?: number;
};

export type SoundAnalyticsEvent =
  | { type: "unlock" }
  | { type: "play"; sound: SoundName; group: SoundGroup }
  | { type: "enabled-changed"; isEnabled: boolean };

export type SoundScenePreset = "quiet" | "focused" | "expressive";

/** Control object returned by loop() to stop a looping sound */
export type LoopControl = {
  stop: () => void;
};

/* ────────────────────────────
   Sound Paths
──────────────────────────── */

/**
 * Semantic sound definitions.
 * Maps logical names to actual file paths in /public/sounds/.
 */
const SOUNDS = {
  // Feedback
  success: "/sounds/success.mp3",
  error: "/sounds/error.wav",
  alert: "/sounds/alert.mp3",
  save: "/sounds/save.mp3",

  // Interactions
  hover: "/sounds/hover.mp3",
  select: "/sounds/select.mp3",
  tap: "/sounds/tap.wav",
  pop: "/sounds/pop.wav",

  // Actions
  achievement: "/sounds/achievement.mp3",
  mint: "/sounds/mint.mp3",
  mintAll: "/sounds/mint-all.mp3",
  notification: "/sounds/notification.mp3",
  quest: "/sounds/quest.mp3",
  presentation: "/sounds/presentation.mp3",
  coins: "/sounds/coins.mp3",

  // Scene / Ambient
  drum: "/sounds/drum.mp3",
  whoosh: "/sounds/whoosh.mp3",
} as const;

export type SoundName = keyof typeof SOUNDS;

/* ────────────────────────────
   Defaults
──────────────────────────── */

const DEFAULTS = {
  volume: 0.25,
  pitch: 1.0,
  pitchVariation: 0.09, // ±9% random variation for organic feel
  duckingVolume: 0.35,
  duckingRelease: 0.25,
};

/** Priority thresholds for each group — sounds duck groups with strictly lower priority */
const GROUP_PRIORITY: Record<SoundGroup, number> = {
  ambient: 0,
  ui: 1,
  feedback: 2,
  critical: 3,
};

/* ────────────────────────────
   Storage Key
──────────────────────────── */

const STORAGE_KEY = "atlas-sounds-enabled";

/* ────────────────────────────
   SoundEffects Class
──────────────────────────── */

class SoundEffects {
  private audioContext: AudioContext | null = null;
  private buffers: Map<string, AudioBuffer> = new Map();
  private pendingLoads: Map<string, Promise<AudioBuffer | null>> = new Map();
  private _isEnabled = true;

  // Audio unlock / warmup state
  private _isUnlocked = false;
  private _hasWarmedUp = false;

  // Scene + analytics
  private activeGroups: Map<SoundGroup, GainNode> = new Map();
  private analyticsListeners: Set<(e: SoundAnalyticsEvent) => void> = new Set();
  private enabledListeners: Set<() => void> = new Set();

  private groupVolumes: Record<SoundGroup, number> = {
    ambient: 1,
    ui: 1,
    feedback: 1,
    critical: 1,
  };

  // Mouse tracking for spatial audio
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  constructor() {
    this.loadEnabledState();
    this.initializeOnUserInteraction();
    this.initMouseTracking();
  }

  /* ──────────────────────────
     Initialization
  ────────────────────────── */

  private loadEnabledState(): void {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        this._isEnabled = stored === "true";
      }
    } catch {
      // localStorage unavailable
    }
  }

  private initializeOnUserInteraction(): void {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const initialize = () => {
      // Remove all listeners — only one needs to fire
      document.removeEventListener("mousedown", initialize);
      document.removeEventListener("keydown", initialize);
      document.removeEventListener("touchstart", initialize);

      this.ensureUnlocked();
    };

    document.addEventListener("mousedown", initialize, { once: true });
    document.addEventListener("keydown", initialize, { once: true });
    document.addEventListener("touchstart", initialize, { once: true });
  }

  /**
   * Shared unlock logic — creates AudioContext, resumes if suspended,
   * emits unlock event, and warms up critical sounds.
   */
  private async ensureUnlocked(): Promise<void> {
    if (typeof window === "undefined") return;

    if (!this.audioContext) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioContextClass();
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume().catch(() => {});
    }

    if (!this._isUnlocked) {
      this._isUnlocked = true;
      this.emit({ type: "unlock" });
    }

    // Warm up critical UI sounds to avoid first-hover latency
    if (!this._hasWarmedUp) {
      this._hasWarmedUp = true;
      this.warmup().catch(() => {});
    }
  }

  private initMouseTracking(): void {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    // Initialize to center
    this.lastMouseX = window.innerWidth / 2;
    this.lastMouseY = window.innerHeight / 2;

    // Track mouse movement (passive for performance)
    document.addEventListener(
      "mousemove",
      (e) => {
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      },
      { passive: true },
    );
  }

  /* ──────────────────────────
     Buffer Loading
  ────────────────────────── */

  private async loadBuffer(path: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(path)) {
      return this.buffers.get(path)!;
    }

    // If another caller is already loading this path, await the same promise
    const pending = this.pendingLoads.get(path);
    if (pending) return pending;

    if (!this.audioContext) return null;

    const promise = this.fetchAndDecode(path);
    this.pendingLoads.set(path, promise);

    try {
      return await promise;
    } finally {
      this.pendingLoads.delete(path);
    }
  }

  private async fetchAndDecode(path: string): Promise<AudioBuffer | null> {
    if (!this.audioContext) return null;

    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to fetch sound: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.buffers.set(path, audioBuffer);
      return audioBuffer;
    } catch (error) {
      console.debug("[Sounds] Could not load sound file:", path, error);
      return null;
    }
  }

  private async warmup(): Promise<void> {
    if (!this.audioContext) return;

    await Promise.all([
      this.loadBuffer(SOUNDS.hover),
      this.loadBuffer(SOUNDS.select),
      this.loadBuffer(SOUNDS.tap),
      this.loadBuffer(SOUNDS.pop),
    ]);
  }

  /* ──────────────────────────
     Enable/Disable
  ────────────────────────── */

  get isEnabled(): boolean {
    return this._isEnabled;
  }

  set isEnabled(value: boolean) {
    this._isEnabled = value;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, String(value));
      } catch {
        // localStorage unavailable
      }
    }
    this.emit({ type: "enabled-changed", isEnabled: value });
    this.notifyEnabledListeners();
  }

  toggle(): boolean {
    this.isEnabled = !this._isEnabled;
    return this._isEnabled;
  }

  /**
   * Explicitly unlock audio playback.
   * Should be called from a user-initiated event (click, keydown, touch).
   */
  async unlock(): Promise<void> {
    return this.ensureUnlocked();
  }

  /* ──────────────────────────
     External Store (for React)
  ────────────────────────── */

  subscribeEnabled(listener: () => void): () => void {
    this.enabledListeners.add(listener);
    return () => this.enabledListeners.delete(listener);
  }

  getEnabledSnapshot = (): boolean => {
    return this._isEnabled;
  };

  private notifyEnabledListeners(): void {
    this.enabledListeners.forEach((cb) => cb());
  }

  /* ──────────────────────────
     Analytics Helpers
  ────────────────────────── */

  onAnalytics(cb: (e: SoundAnalyticsEvent) => void): () => void {
    this.analyticsListeners.add(cb);
    return () => this.analyticsListeners.delete(cb);
  }

  private emit(event: SoundAnalyticsEvent): void {
    this.analyticsListeners.forEach((cb) => cb(event));
  }

  /* ──────────────────────────
     Scene Helpers
  ────────────────────────── */

  private getGroupGain(group: SoundGroup): GainNode | null {
    if (!this.audioContext) return null;

    if (!this.activeGroups.has(group)) {
      const gain = this.audioContext.createGain();
      gain.gain.value = this.groupVolumes[group];
      gain.connect(this.audioContext.destination);
      this.activeGroups.set(group, gain);
    }

    return this.activeGroups.get(group)!;
  }

  /**
   * Duck groups with priority strictly lower than the given threshold.
   * Uses properly anchored ramps to avoid Web Audio scheduling artifacts.
   */
  private duck(priorityThreshold: number): void {
    const ctx = this.audioContext;
    if (!ctx) return;

    const now = ctx.currentTime;

    this.activeGroups.forEach((gain, group) => {
      // Only duck groups with lower priority than the triggering sound
      if (GROUP_PRIORITY[group] >= priorityThreshold) return;

      gain.gain.cancelScheduledValues(now);
      // Anchor current value, ramp down, anchor at ducked level, ramp back up
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(DEFAULTS.duckingVolume, now + 0.01);
      gain.gain.setValueAtTime(DEFAULTS.duckingVolume, now + 0.01);
      gain.gain.linearRampToValueAtTime(this.groupVolumes[group], now + DEFAULTS.duckingRelease);
    });
  }

  /* ──────────────────────────
     Core Playback
  ────────────────────────── */

  private playBuffer(
    buffer: AudioBuffer,
    sound: SoundName | null,
    options: PlayOptions & SoundSceneOptions = {},
  ): void {
    if (!this._isEnabled || !this.audioContext || !this._isUnlocked) {
      return;
    }

    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }

    try {
      const ctx = this.audioContext;
      const now = ctx.currentTime;

      const group = options.group ?? "ui";
      const priority = options.priority ?? 0;

      if (priority > 0) {
        this.duck(GROUP_PRIORITY[group]);
      }

      // Calculate pitch with random variation for organic feel
      const basePitch = options.pitch ?? DEFAULTS.pitch;
      const randomOffset = (Math.random() - 0.5) * 2 * DEFAULTS.pitchVariation;
      let finalPitch = basePitch + randomOffset;

      const volume = options.volume ?? DEFAULTS.volume;
      const duration = options.duration;

      // Calculate pan from spatial position
      let pan = 0;
      if (options.spatial !== undefined && typeof window !== "undefined") {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const screenCenterX = screenWidth / 2;
        const screenCenterY = screenHeight / 2;

        // Get X position: true = mouse, number = explicit
        const x = options.spatial === true ? this.lastMouseX : (options.spatial as number);
        const y = options.spatial === true ? this.lastMouseY : screenCenterY;

        // X -> stereo pan (-1 to +1)
        pan = Math.max(-1, Math.min(1, (x - screenCenterX) / screenCenterX));

        // Y -> pitch adjustment (top = higher, bottom = lower)
        // Only apply if using mouse tracking (spatial: true)
        if (options.spatial === true) {
          const verticalOffset = (screenCenterY - y) / screenCenterY; // -1 (bottom) to +1 (top)
          const pitchFromY = verticalOffset * 0.1; // +-10% pitch shift based on Y
          finalPitch += pitchFromY;
        }
      }

      // Create nodes
      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      const pannerNode = ctx.createStereoPanner();

      // Configure
      source.buffer = buffer;
      source.playbackRate.value = finalPitch;
      gainNode.gain.setValueAtTime(volume, now);
      pannerNode.pan.value = pan;

      // Fade out to avoid click artifacts
      if (duration) {
        const fadeStart = now + duration - 0.01;
        gainNode.gain.setValueAtTime(volume, fadeStart);
        gainNode.gain.linearRampToValueAtTime(0, now + duration);
      }

      const groupGain = this.getGroupGain(group);
      if (!groupGain) return;

      // Connect: source -> gain -> panner -> group -> destination
      source.connect(gainNode);
      gainNode.connect(pannerNode);
      pannerNode.connect(groupGain);

      if (sound) {
        this.emit({ type: "play", sound, group });
      }

      // Play
      source.start(now);
      if (duration) {
        source.stop(now + duration);
      }
    } catch (error) {
      console.debug("[Sounds] Playback error:", error);
    }
  }

  /* ──────────────────────────
     Public API
  ────────────────────────── */

  /**
   * Play a named sound.
   *
   * @param name - Sound name from the SOUNDS registry (e.g., "select", "mint")
   * @param options - Optional settings for volume, pitch, spatial position, duration, group
   *
   * @example
   * // Simple (centered)
   * sounds.play("select");
   *
   * // With volume
   * sounds.play("mint", { volume: 0.2 });
   *
   * // Spatial from mouse position (auto-tracks X for pan, Y for pitch)
   * sounds.play("hover", { spatial: true });
   *
   * // Spatial from explicit X position (e.g., element center)
   * const rect = element.getBoundingClientRect();
   * sounds.play("pop", { spatial: rect.left + rect.width / 2 });
   */
  async play(name: SoundName, options?: PlayOptions & SoundSceneOptions): Promise<void> {
    const path = SOUNDS[name];
    const buffer = await this.loadBuffer(path);
    if (buffer) {
      this.playBuffer(buffer, name, options);
    }
  }

  setGroupVolume(group: SoundGroup, volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.groupVolumes[group] = clamped;

    const gain = this.activeGroups.get(group);
    if (gain && this.audioContext) {
      gain.gain.setValueAtTime(clamped, this.audioContext.currentTime);
    }
  }

  getGroupVolume(group: SoundGroup): number {
    return this.groupVolumes[group];
  }

  setScene(preset: SoundScenePreset): void {
    switch (preset) {
      case "quiet":
        this.setGroupVolume("ambient", 0.2);
        this.setGroupVolume("ui", 0.4);
        this.setGroupVolume("feedback", 0.6);
        this.setGroupVolume("critical", 1);
        break;

      case "focused":
        this.setGroupVolume("ambient", 0.4);
        this.setGroupVolume("ui", 0.7);
        this.setGroupVolume("feedback", 0.8);
        this.setGroupVolume("critical", 1);
        break;

      case "expressive":
      default:
        this.setGroupVolume("ambient", 0.8);
        this.setGroupVolume("ui", 1);
        this.setGroupVolume("feedback", 1);
        this.setGroupVolume("critical", 1);
        break;
    }
  }

  /* ──────────────────────────
     Semantic Sound Methods
  ────────────────────────── */

  /** Play success feedback sound */
  success(options?: PlayOptions): Promise<void> {
    return this.play("success", { group: "feedback", priority: 2, ...options });
  }

  /** Play error feedback sound (with lower pitch) */
  error(options?: PlayOptions): Promise<void> {
    return this.play("error", { group: "feedback", priority: 2, pitch: 0.8, ...options });
  }

  /** Play UI select/click sound */
  select(options?: PlayOptions): Promise<void> {
    return this.play("select", { group: "ui", ...options });
  }

  /** Play UI tap sound */
  tap(options?: PlayOptions): Promise<void> {
    return this.play("tap", { group: "ui", ...options });
  }

  /** Play UI pop sound */
  pop(options?: PlayOptions): Promise<void> {
    return this.play("pop", { group: "ui", ...options });
  }

  /** Play hover sound */
  hover(options?: PlayOptions): Promise<void> {
    return this.play("hover", { group: "ui", priority: 0, ...options });
  }

  /** Play mint/blockchain action sound */
  mint(options?: PlayOptions): Promise<void> {
    return this.play("mint", { group: "critical", priority: 3, ...options });
  }

  /** Play batch mint sound (while minting multiple attestations) */
  mintAll(options?: PlayOptions): Promise<void> {
    return this.play("mintAll", { group: "critical", ...options });
  }

  /** Play notification sound */
  notification(options?: PlayOptions): Promise<void> {
    return this.play("notification", { group: "feedback", priority: 1, ...options });
  }

  /** Play alert sound */
  alert(options?: PlayOptions): Promise<void> {
    return this.play("alert", { group: "feedback", priority: 2, ...options });
  }

  /** Play save confirmation sound */
  save(options?: PlayOptions): Promise<void> {
    return this.play("save", { group: "feedback", ...options });
  }

  /** Play achievement sound */
  achievement(options?: PlayOptions): Promise<void> {
    return this.play("achievement", { group: "critical", priority: 3, ...options });
  }

  /** Play quest sound */
  quest(options?: PlayOptions): Promise<void> {
    return this.play("quest", { group: "critical", priority: 2, ...options });
  }

  /** Play presentation sound */
  presentation(options?: PlayOptions): Promise<void> {
    return this.play("presentation", { group: "ambient", ...options });
  }

  /** Play coins sound */
  coins(options?: PlayOptions): Promise<void> {
    return this.play("coins", { group: "feedback", priority: 1, ...options });
  }

  /* ──────────────────────────
     Looping Playback
  ────────────────────────── */

  /**
   * Start looping a sound until stop() is called.
   * Returns a control object with a stop() function.
   *
   * @example
   * const loop = await sounds.loop("mintAll");
   * // ... do work ...
   * loop.stop(); // Stops the loop with a quick fade out
   */
  async loop(
    name: SoundName,
    options?: PlayOptions & SoundSceneOptions,
  ): Promise<LoopControl> {
    const path = SOUNDS[name];
    const buffer = await this.loadBuffer(path);
    if (!buffer || !this.audioContext || !this._isEnabled || !this._isUnlocked) {
      return { stop: () => {} };
    }

    const ctx = this.audioContext;

    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }

    const group = options?.group ?? "ui";
    const groupGain = this.getGroupGain(group);
    if (!groupGain) return { stop: () => {} };

    const source = ctx.createBufferSource();
    const gainNode = ctx.createGain();

    source.buffer = buffer;
    source.loop = true;
    gainNode.gain.value = options?.volume ?? DEFAULTS.volume;

    // Route through group gain so loops respect setGroupVolume/setScene/ducking
    source.connect(gainNode);
    gainNode.connect(groupGain);
    source.start();

    return {
      stop: () => {
        try {
          // Fade out quickly to avoid click artifacts
          const now = ctx.currentTime;
          gainNode.gain.setValueAtTime(gainNode.gain.value, now);
          gainNode.gain.linearRampToValueAtTime(0, now + 0.1);
          source.stop(now + 0.1);
        } catch {
          // Already stopped
        }
      },
    };
  }

  /** Loop the mintAll sound (for batch minting) */
  loopMintAll(options?: PlayOptions): Promise<LoopControl> {
    return this.loop("mintAll", { group: "critical", ...options });
  }
}

/* ────────────────────────────
   Singleton Export
──────────────────────────── */

export const sounds = new SoundEffects();

/* ────────────────────────────
   React Hook
──────────────────────────── */

/**
 * Hook to access sounds with reactive enabled state.
 * Uses useSyncExternalStore so all components stay in sync.
 */
export function useSounds() {
  const isEnabled = useSyncExternalStore(
    (cb) => sounds.subscribeEnabled(cb),
    sounds.getEnabledSnapshot,
    // SSR snapshot — default to true
    () => true,
  );

  const toggle = useCallback(() => {
    return sounds.toggle();
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    sounds.isEnabled = value;
  }, []);

  const unlock = useCallback(() => {
    return sounds.unlock();
  }, []);

  const setGroupVolume = useCallback(
    (group: SoundGroup, volume: number) => {
      sounds.setGroupVolume(group, volume);
    },
    [],
  );

  const setScene = useCallback((scene: SoundScenePreset) => {
    sounds.setScene(scene);
  }, []);

  return {
    sounds,
    isEnabled,
    toggle,
    setEnabled,
    unlock,
    setGroupVolume,
    setScene,
  };
}


