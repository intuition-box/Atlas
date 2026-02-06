/**
 * Sound effects utility for UI interactions.
 *
 * Uses Web Audio API for low-latency playback with pitch/volume control.
 * Lazy-initializes on first user interaction (browser requirement).
 *
 * Supports both preset sounds and custom sound files:
 * - Presets: sounds.pop(), sounds.success(), sounds.error()
 * - Custom: sounds.playFile("/sounds/mint.mp3")
 */

/* ────────────────────────────
   Types
──────────────────────────── */

type SoundConfig = {
  pitchShift?: number;
  volume?: number;
  duration?: number;
  pan?: number; // -1 (left) to 1 (right)
};

type PresetType = "pop" | "success" | "click" | "hover" | "error";

type PresetConfig = Required<Pick<SoundConfig, "pitchShift" | "volume">> & {
  file: string;
  duration?: number;
};

/* ────────────────────────────
   Sound Presets
──────────────────────────── */

const SOUND_PRESETS: Record<PresetType, PresetConfig> = {
  // Satisfying "plop" for adding to queue
  pop: { file: "/sounds/select.mp3", pitchShift: 1.2, volume: 0.15, duration: 0.1 },
  // Success chime for saves/mints
  success: { file: "/sounds/tnx-success.mp3", pitchShift: 1.0, volume: 0.12 },
  // Button clicks
  click: { file: "/sounds/select.mp3", pitchShift: 1.4, volume: 0.1, duration: 0.08 },
  // Subtle hover feedback
  hover: { file: "/sounds/select.mp3", pitchShift: 1.6, volume: 0.06, duration: 0.05 },
  // Soft error tone
  error: { file: "/sounds/select.mp3", pitchShift: 0.8, volume: 0.1, duration: 0.12 },
};

/* ────────────────────────────
   Default Config
──────────────────────────── */

const DEFAULT_CONFIG: Required<Omit<SoundConfig, "duration">> = {
  pitchShift: 1.0,
  volume: 0.15,
  pan: 0,
};

/* ────────────────────────────
   Storage Key
──────────────────────────── */

const STORAGE_KEY = "orbyt-sounds-enabled";

/* ────────────────────────────
   SoundEffects Class
──────────────────────────── */

class SoundEffects {
  private audioContext: AudioContext | null = null;
  private buffers: Map<string, AudioBuffer> = new Map();
  private loadingPaths: Set<string> = new Set();
  private _isEnabled = true;

  constructor() {
    this.loadEnabledState();
    this.initializeOnUserInteraction();
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
      if (!this.audioContext) {
        // Create AudioContext (with webkit fallback for Safari)
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.audioContext = new AudioContextClass();
      }
    };

    // Initialize on first user interaction
    document.addEventListener("mousedown", initialize, { once: true });
    document.addEventListener("keydown", initialize, { once: true });
    document.addEventListener("touchstart", initialize, { once: true });
  }

  /* ──────────────────────────
     Buffer Loading
  ────────────────────────── */

  /**
   * Load and cache a sound buffer from a file path.
   */
  private async loadBuffer(path: string): Promise<AudioBuffer | null> {
    // Return cached buffer
    if (this.buffers.has(path)) {
      return this.buffers.get(path)!;
    }

    // Already loading this path
    if (this.loadingPaths.has(path)) {
      // Wait a bit and check again
      await new Promise((resolve) => setTimeout(resolve, 50));
      return this.buffers.get(path) ?? null;
    }

    // Ensure AudioContext exists
    if (!this.audioContext) {
      return null;
    }

    this.loadingPaths.add(path);

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
    } finally {
      this.loadingPaths.delete(path);
    }
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
  }

  toggle(): boolean {
    this.isEnabled = !this._isEnabled;
    return this._isEnabled;
  }

  /* ──────────────────────────
     Core Playback
  ────────────────────────── */

  /**
   * Play a buffer with the given config.
   */
  private playBuffer(buffer: AudioBuffer, config: SoundConfig = {}): void {
    if (!this._isEnabled || !this.audioContext) {
      return;
    }

    // Resume suspended context (browser autoplay policy)
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }

    try {
      const ctx = this.audioContext;
      const now = ctx.currentTime;

      const pitchShift = config.pitchShift ?? DEFAULT_CONFIG.pitchShift;
      const volume = config.volume ?? DEFAULT_CONFIG.volume;
      const pan = config.pan ?? DEFAULT_CONFIG.pan;
      const duration = config.duration;

      // Create nodes
      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      const pannerNode = ctx.createStereoPanner();

      // Configure
      source.buffer = buffer;
      source.playbackRate.value = pitchShift;
      gainNode.gain.setValueAtTime(volume, now);
      pannerNode.pan.value = pan;

      // Fade out to avoid click artifacts
      if (duration) {
        const fadeStart = now + duration - 0.01;
        gainNode.gain.setValueAtTime(volume, fadeStart);
        gainNode.gain.linearRampToValueAtTime(0, now + duration);
      }

      // Connect: source -> gain -> panner -> destination
      source.connect(gainNode);
      gainNode.connect(pannerNode);
      pannerNode.connect(ctx.destination);

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
     Public Methods - Custom Files
  ────────────────────────── */

  /**
   * Play any sound file by path. Lazy-loads and caches.
   *
   * @param path - Path to sound file (e.g., "/sounds/mint.mp3")
   * @param options - Optional pitch/volume/pan/duration overrides
   */
  async playFile(path: string, options?: SoundConfig): Promise<void> {
    const buffer = await this.loadBuffer(path);
    if (buffer) {
      this.playBuffer(buffer, options);
    }
  }

  /**
   * Play a sound file with spatial positioning based on screen location.
   *
   * @param path - Path to sound file
   * @param x - X coordinate (e.g., from click event)
   * @param options - Optional config overrides
   */
  async playFileSpatial(path: string, x: number, options?: SoundConfig): Promise<void> {
    if (typeof window === "undefined") {
      return this.playFile(path, options);
    }

    const screenCenter = window.innerWidth / 2;
    const pan = Math.max(-1, Math.min(1, (x - screenCenter) / screenCenter));
    const pitchOffset = pan * 0.1;

    return this.playFile(path, {
      ...options,
      pitchShift: (options?.pitchShift ?? DEFAULT_CONFIG.pitchShift) + pitchOffset,
      pan,
    });
  }

  /**
   * Play a sound file with spatial positioning from a MouseEvent.
   */
  async playFileFromEvent(
    path: string,
    event: { clientX: number },
    options?: SoundConfig
  ): Promise<void> {
    return this.playFileSpatial(path, event.clientX, options);
  }

  /**
   * Play a sound file with spatial positioning from an element's center.
   */
  async playFileFromElement(
    path: string,
    element: Element,
    options?: SoundConfig
  ): Promise<void> {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    return this.playFileSpatial(path, centerX, options);
  }

  /* ──────────────────────────
     Public Methods - Presets
  ────────────────────────── */

  /**
   * Play a preset sound by type.
   */
  play(type: PresetType): void {
    const preset = SOUND_PRESETS[type];
    this.playFile(preset.file, {
      pitchShift: preset.pitchShift,
      volume: preset.volume,
      duration: preset.duration,
    });
  }

  /**
   * Play pop sound (attestation added to queue).
   */
  pop(): void {
    this.play("pop");
  }

  /**
   * Play success sound (operation completed).
   */
  success(): void {
    this.play("success");
  }

  /**
   * Play click sound (button pressed).
   */
  click(): void {
    this.play("click");
  }

  /**
   * Play hover sound (element hovered).
   * Optionally vary pitch based on element ID for subtle uniqueness.
   */
  hover(elementId?: string): void {
    if (elementId) {
      const hash = this.hashString(elementId);
      const pitchVariation = 1.5 + hash * 0.3;
      const preset = SOUND_PRESETS.hover;
      this.playFile(preset.file, {
        pitchShift: pitchVariation,
        volume: 0.05,
        duration: 0.05,
      });
    } else {
      this.play("hover");
    }
  }

  /**
   * Play error sound (operation failed).
   */
  error(): void {
    this.play("error");
  }

  /**
   * Play a preset sound with spatial positioning.
   */
  playSpatial(type: PresetType, x: number): void {
    const preset = SOUND_PRESETS[type];
    this.playFileSpatial(preset.file, x, {
      pitchShift: preset.pitchShift,
      volume: preset.volume,
      duration: preset.duration,
    });
  }

  /**
   * Play a preset sound from a MouseEvent.
   */
  playFromEvent(type: PresetType, event: { clientX: number }): void {
    this.playSpatial(type, event.clientX);
  }

  /**
   * Play a preset sound from an element's center.
   */
  playFromElement(type: PresetType, element: Element): void {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    this.playSpatial(type, centerX);
  }

  /* ──────────────────────────
     Helpers
  ────────────────────────── */

  /**
   * Simple string hash for consistent pitch variations.
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash) / 2147483647;
  }
}

/* ────────────────────────────
   Singleton Export
──────────────────────────── */

export const sounds = new SoundEffects();

/* ────────────────────────────
   React Hook
──────────────────────────── */

import { useState, useCallback } from "react";

/**
 * Hook to access sounds with reactive enabled state.
 */
export function useSounds() {
  const [isEnabled, setIsEnabled] = useState(sounds.isEnabled);

  const toggle = useCallback(() => {
    const newValue = sounds.toggle();
    setIsEnabled(newValue);
    return newValue;
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    sounds.isEnabled = value;
    setIsEnabled(value);
  }, []);

  return {
    sounds,
    isEnabled,
    toggle,
    setEnabled,
  };
}
