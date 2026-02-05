/**
 * Sound effects utility for UI interactions.
 *
 * Uses Web Audio API for low-latency playback with pitch/volume control.
 * Lazy-initializes on first user interaction (browser requirement).
 */

/* ────────────────────────────
   Types
──────────────────────────── */

type SoundType = "pop" | "success" | "click" | "hover" | "error";

type SoundConfig = {
  pitchShift: number;
  volume: number;
  duration?: number;
};

/* ────────────────────────────
   Sound Presets
──────────────────────────── */

const SOUND_PRESETS: Record<SoundType, SoundConfig> = {
  // Satisfying "plop" for adding to queue
  pop: { pitchShift: 1.2, volume: 0.15, duration: 0.1 },
  // Success chime for saves/mints
  success: { pitchShift: 1.5, volume: 0.12, duration: 0.15 },
  // Button clicks
  click: { pitchShift: 1.4, volume: 0.1, duration: 0.08 },
  // Subtle hover feedback
  hover: { pitchShift: 1.6, volume: 0.06, duration: 0.05 },
  // Soft error tone
  error: { pitchShift: 0.8, volume: 0.1, duration: 0.12 },
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
  private audioBuffer: AudioBuffer | null = null;
  private isLoading = false;
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
        this.loadSound("/sounds/ui-click.mp3");
      }
    };

    // Initialize on first user interaction
    document.addEventListener("mousedown", initialize, { once: true });
    document.addEventListener("keydown", initialize, { once: true });
    document.addEventListener("touchstart", initialize, { once: true });
  }

  private async loadSound(url: string): Promise<void> {
    if (this.isLoading || this.audioBuffer || !this.audioContext) return;

    this.isLoading = true;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch sound: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    } catch (error) {
      // Sound file not found - sounds will be silently disabled
      console.debug("[Sounds] Could not load sound file:", error);
    } finally {
      this.isLoading = false;
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
     Playback
  ────────────────────────── */

  /**
   * Play a sound with custom parameters.
   */
  private playSound(config: SoundConfig): void {
    if (!this._isEnabled || !this.audioContext || !this.audioBuffer) {
      return;
    }

    // Resume suspended context (browser autoplay policy)
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }

    try {
      const ctx = this.audioContext;
      const now = ctx.currentTime;

      // Create nodes
      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();

      // Configure
      source.buffer = this.audioBuffer;
      source.playbackRate.value = config.pitchShift;
      gainNode.gain.setValueAtTime(config.volume, now);

      // Fade out to avoid click artifacts
      if (config.duration) {
        const fadeStart = now + config.duration - 0.01;
        gainNode.gain.setValueAtTime(config.volume, fadeStart);
        gainNode.gain.linearRampToValueAtTime(0, now + config.duration);
      }

      // Connect: source -> gain -> destination
      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Play
      source.start(now);
      if (config.duration) {
        source.stop(now + config.duration);
      }
    } catch (error) {
      console.debug("[Sounds] Playback error:", error);
    }
  }

  /* ──────────────────────────
     Public Methods
  ────────────────────────── */

  /**
   * Play a preset sound by type.
   */
  play(type: SoundType): void {
    const config = SOUND_PRESETS[type];
    this.playSound(config);
  }

  /**
   * Play pop sound (attestation added to queue).
   */
  pop(): void {
    this.play("pop");
  }

  /**
   * Play success sound (save/mint completed).
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
      const pitchVariation = 1.5 + hash * 0.3; // Range: 1.5 to 1.8
      this.playSound({
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
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) / 2147483647; // Normalize to 0-1
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
