/**
 * Sound effects utility for UI interactions.
 *
 * Uses Web Audio API for low-latency playback with automatic pitch variation
 * for organic, non-robotic feel. Lazy-initializes on first user interaction.
 *
 * Usage:
 *   sounds.play("/sounds/mint.mp3");
 *   sounds.play("/sounds/select.mp3", { volume: 0.2 });
 *   sounds.play("/sounds/click.mp3", { spatial: true }); // use mouse position
 *   sounds.play("/sounds/pop.mp3", { spatial: 300 }); // explicit X position
 */

/* ────────────────────────────
   Types
──────────────────────────── */

type PlayOptions = {
  /** Base volume (0-1). Default: 0.15 */
  volume?: number;
  /** Base pitch multiplier. Random variation (±8%) added automatically. Default: 1.0 */
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

/* ────────────────────────────
   Defaults
──────────────────────────── */

const DEFAULTS = {
  volume: 0.15,
  pitch: 1.0,
  pitchVariation: 0.08, // ±8% random variation for organic feel
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
      if (!this.audioContext) {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.audioContext = new AudioContextClass();
      }
    };

    document.addEventListener("mousedown", initialize, { once: true });
    document.addEventListener("keydown", initialize, { once: true });
    document.addEventListener("touchstart", initialize, { once: true });
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
      { passive: true }
    );
  }

  /* ──────────────────────────
     Buffer Loading
  ────────────────────────── */

  private async loadBuffer(path: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(path)) {
      return this.buffers.get(path)!;
    }

    if (this.loadingPaths.has(path)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return this.buffers.get(path) ?? null;
    }

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

  private playBuffer(buffer: AudioBuffer, options: PlayOptions = {}): void {
    if (!this._isEnabled || !this.audioContext) {
      return;
    }

    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }

    try {
      const ctx = this.audioContext;
      const now = ctx.currentTime;

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
        const x = options.spatial === true ? this.lastMouseX : options.spatial;
        const y = options.spatial === true ? this.lastMouseY : screenCenterY;

        // X → stereo pan (-1 to +1)
        pan = Math.max(-1, Math.min(1, (x - screenCenterX) / screenCenterX));

        // Y → pitch adjustment (top = higher, bottom = lower)
        // Only apply if using mouse tracking (spatial: true)
        if (options.spatial === true) {
          const verticalOffset = (screenCenterY - y) / screenCenterY; // -1 (bottom) to +1 (top)
          const pitchFromY = verticalOffset * 0.1; // ±10% pitch shift based on Y
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
     Public API
  ────────────────────────── */

  /**
   * Play a sound file.
   *
   * @param path - Path to sound file (e.g., "/sounds/mint.mp3")
   * @param options - Optional settings for volume, pitch, spatial position, duration
   *
   * @example
   * // Simple (centered)
   * sounds.play("/sounds/select.mp3");
   *
   * // With volume
   * sounds.play("/sounds/mint.mp3", { volume: 0.2 });
   *
   * // Spatial from mouse position (auto-tracks X for pan, Y for pitch)
   * sounds.play("/sounds/click.mp3", { spatial: true });
   *
   * // Spatial from explicit X position (e.g., element center)
   * const rect = element.getBoundingClientRect();
   * sounds.play("/sounds/pop.mp3", { spatial: rect.left + rect.width / 2 });
   */
  async play(path: string, options?: PlayOptions): Promise<void> {
    const buffer = await this.loadBuffer(path);
    if (buffer) {
      this.playBuffer(buffer, options);
    }
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
