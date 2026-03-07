/**
 * Real-world stress tests for the full rPPG pipeline (processRPPG).
 *
 * These tests simulate adverse conditions encountered with webcams, laptop cameras,
 * mobile phones (front/back), and tablets across diverse environments and subjects.
 * Each test pushes synthetic RGB data through the complete pipeline:
 *   POS → detrend → filtfilt → FFT → BPM
 */

import { describe, it, expect } from 'vitest';
import { processRPPG, posAlgorithm, createBpmSmoothingState } from './rppg';
import type { RGBSample, BpmSmoothingState } from './rppg';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Base skin tone for synthetic signals */
const SKIN = { r: 180, g: 140, b: 100 };

/**
 * Generate synthetic RGB samples with embedded pulse and optional perturbations.
 * @param opts.sampleRate - Camera FPS
 * @param opts.durationSec - Signal duration
 * @param opts.pulseHz - Heart rate in Hz (BPM / 60)
 * @param opts.pulseAmplitude - Pulse modulation depth (typical: 0.01–0.05)
 * @param opts.perturb - Per-sample perturbation function (i, t, base) => {r, g, b}
 */
function makeSyntheticRGB(opts: {
  sampleRate: number;
  durationSec: number;
  pulseHz: number;
  pulseAmplitude?: number;
  skin?: { r: number; g: number; b: number };
  perturb?: (i: number, t: number, base: { r: number; g: number; b: number }) => { r: number; g: number; b: number };
}): RGBSample[] {
  const {
    sampleRate,
    durationSec,
    pulseHz,
    pulseAmplitude = 0.02,
    skin = SKIN,
    perturb,
  } = opts;
  const n = Math.round(sampleRate * durationSec);
  const samples: RGBSample[] = [];

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const pulse = pulseAmplitude * Math.sin(2 * Math.PI * pulseHz * t);

    let r = skin.r * (1 + pulse * 0.5);
    let g = skin.g * (1 + pulse);
    let b = skin.b * (1 + pulse * 0.3);

    if (perturb) {
      const p = perturb(i, t, { r, g, b });
      r = p.r;
      g = p.g;
      b = p.b;
    }

    samples.push({ r, g, b, timestamp: t * 1000 });
  }
  return samples;
}

/** Helper: check that BPM is within range of expected */
function expectBpmNear(result: ReturnType<typeof processRPPG>, expectedBpm: number, tolerance: number) {
  expect(result).not.toBeNull();
  if (!result) return;
  expect(result.bpm).toBeGreaterThan(expectedBpm - tolerance);
  expect(result.bpm).toBeLessThan(expectedBpm + tolerance);
}

/** Helper: Gaussian noise */
function gaussianNoise(sigma: number): number {
  // Box-Muller transform
  const u1 = Math.random() || 1e-10;
  const u2 = Math.random();
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Use deterministic seed for reproducibility
let seed = 42;
function seededRandom(): number {
  seed = (seed * 1664525 + 1013904223) & 0xffffffff;
  return (seed >>> 0) / 0xffffffff;
}

function seededGaussian(sigma: number): number {
  const u1 = seededRandom() || 1e-10;
  const u2 = seededRandom();
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ─── Lighting Conditions ─────────────────────────────────────────────────────

describe('processRPPG: lighting conditions', () => {
  it('detects pulse under 60Hz fluorescent flicker (North America)', () => {
    // 60Hz fluorescent at 30fps creates a beat at 0Hz (DC) and harmonics.
    // At 30fps, 60Hz aliases to 0Hz — manifests as frame-to-frame brightness oscillation.
    const flickerAmplitude = 0.15; // 15% brightness modulation from flicker
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          // 60Hz sampled at 30fps → alternating +/- pattern (aliased to Nyquist)
          const flicker = flickerAmplitude * (i % 2 === 0 ? 1 : -1);
          return {
            r: base.r * (1 + flicker),
            g: base.g * (1 + flicker),
            b: base.b * (1 + flicker),
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 72, 12);
  });

  it('detects pulse under 50Hz fluorescent flicker (Europe/Asia)', () => {
    // 50Hz at 30fps: 50 mod 30 = 20Hz alias, well outside cardiac band
    // But creates beating pattern at 10Hz (50-2*30=−10 → folds to 10Hz)
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.5, // 90 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          const flicker = 0.12 * Math.sin(2 * Math.PI * 50 * t);
          return {
            r: base.r * (1 + flicker),
            g: base.g * (1 + flicker),
            b: base.b * (1 + flicker),
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 90, 12);
  });

  it('detects pulse under old magnetic-ballast fluorescent (120Hz flicker)', () => {
    // Older fluorescent tubes with magnetic ballasts flicker at 2× mains frequency
    // 120Hz at 30fps aliases to 0Hz (120/30 = 4, exact multiple)
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.33, // ~80 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          const flicker = 0.08 * Math.sin(2 * Math.PI * 120 * t);
          return {
            r: base.r * (1 + flicker),
            g: base.g * (1 + flicker),
            b: base.b * (1 + flicker),
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 80, 12);
  });

  it('detects pulse with sunlight through horizontal blinds (striping)', () => {
    // Slow head sway causes striped shadow pattern to oscillate across face
    // Models as slow periodic brightness modulation at ~0.15 Hz (head sway frequency)
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          // 0.15 Hz sway through blinds — large amplitude shadow modulation
          const shadow = 0.25 * Math.sin(2 * Math.PI * 0.15 * t);
          return {
            r: base.r * (1 + shadow),
            g: base.g * (1 + shadow),
            b: base.b * (1 + shadow),
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 72, 12);
  });

  it('detects pulse in very low light (high camera gain noise)', () => {
    // Low light → camera increases gain → high Gaussian noise, low signal amplitude
    seed = 42;
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.015, // weaker pulse signal in low light
        skin: { r: 80, g: 60, b: 45 }, // darker exposure
        perturb: (i, t, base) => ({
          r: Math.max(1, base.r + seededGaussian(8)),
          g: Math.max(1, base.g + seededGaussian(8)),
          b: Math.max(1, base.b + seededGaussian(6)),
        }),
      }),
      30,
    );
    // In very low light, we accept wider tolerance or at least non-null result
    expect(result).not.toBeNull();
    if (result) {
      expect(result.bpm).toBeGreaterThan(45);
      expect(result.bpm).toBeLessThan(180);
    }
  });

  it('detects pulse with backlighting (face underexposed)', () => {
    // Window behind subject → face in shadow, low contrast, compressed dynamic range
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.33, // 80 BPM
        pulseAmplitude: 0.01, // very weak pulse in underexposed face
        skin: { r: 60, g: 45, b: 35 }, // underexposed
      }),
      30,
    );
    expect(result).not.toBeNull();
    if (result) {
      // With very weak signal, we at minimum expect a valid result
      expect(result.bpm).toBeGreaterThan(40);
      expect(result.bpm).toBeLessThan(200);
    }
  });

  it('detects pulse under colored LED ambient lighting (warm)', () => {
    // RGB LED strip set to warm orange — shifts skin tone significantly
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.03,
        skin: { r: 210, g: 130, b: 60 }, // warm-shifted skin
      }),
      30,
    );
    expectBpmNear(result, 72, 12);
  });

  it('detects pulse under cold/blue office lighting', () => {
    // Blue-white LED office lights shift skin tone toward blue
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.5, // 90 BPM
        pulseAmplitude: 0.025,
        skin: { r: 150, g: 140, b: 130 }, // cool-shifted, less red
      }),
      30,
    );
    expectBpmNear(result, 90, 12);
  });

  it('handles rapid lighting transition (walking between rooms)', () => {
    // Abrupt brightness change at t=5s simulating entering a darker room
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          const scale = t < 5 ? 1.0 : 0.4; // sudden 60% brightness drop
          return {
            r: base.r * scale,
            g: base.g * scale,
            b: base.b * scale,
          };
        },
      }),
      30,
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result.bpm).toBeGreaterThan(45);
      expect(result.bpm).toBeLessThan(180);
    }
  });

  it('detects pulse under mixed lighting (daylight window + overhead fluorescent)', () => {
    // Two interference patterns: slow cloud-driven daylight drift + 60Hz flicker
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.33, // 80 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          const cloudDrift = 0.1 * Math.sin(2 * Math.PI * 0.05 * t); // very slow cloud
          const flicker = 0.08 * (i % 2 === 0 ? 1 : -1); // 60Hz alias
          return {
            r: base.r * (1 + cloudDrift + flicker),
            g: base.g * (1 + cloudDrift + flicker),
            b: base.b * (1 + cloudDrift + flicker),
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 80, 12);
  });
});

// ─── Camera/Device Conditions ────────────────────────────────────────────────

describe('processRPPG: camera and device conditions', () => {
  it('handles low-resolution mobile front camera (noisy, quantized)', () => {
    // Low-res cameras have more quantization noise and compression artifacts
    seed = 123;
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => ({
          // Quantize to simulate 8-bit + JPEG compression artifacts
          r: Math.round(base.r + seededGaussian(3)),
          g: Math.round(base.g + seededGaussian(3)),
          b: Math.round(base.b + seededGaussian(3)),
        }),
      }),
      30,
    );
    expectBpmNear(result, 72, 12);
  });

  it('handles 25fps webcam (common in budget USB cameras)', () => {
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 25,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.03,
      }),
      25,
    );
    expectBpmNear(result, 72, 12);
  });

  it('handles 24fps camera (cinematic mode on some phones)', () => {
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 24,
        durationSec: 12,
        pulseHz: 1.33, // 80 BPM
        pulseAmplitude: 0.03,
      }),
      24,
    );
    expectBpmNear(result, 80, 12);
  });

  it('handles 60fps camera (modern phones, high-end webcams)', () => {
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 60,
        durationSec: 12,
        pulseHz: 1.5, // 90 BPM
        pulseAmplitude: 0.02,
      }),
      60,
    );
    expectBpmNear(result, 90, 12);
  });

  it('handles 15fps (throttled mobile camera, background tab)', () => {
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 15,
        durationSec: 15, // need longer for lower fps
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.04, // stronger to compensate for fewer samples
      }),
      15,
    );
    expectBpmNear(result, 72, 15);
  });

  it('handles auto-white-balance shift (color temperature change)', () => {
    // Camera AWB adjusts over 3s, shifting red/blue balance
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          // AWB shift: warm→cool transition over 3 seconds starting at t=4
          const progress = Math.max(0, Math.min(1, (t - 4) / 3));
          const rScale = 1.0 - 0.15 * progress; // red decreases
          const bScale = 1.0 + 0.15 * progress; // blue increases
          return {
            r: base.r * rScale,
            g: base.g,
            b: base.b * bScale,
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 72, 12);
  });

  it('handles auto-exposure ramp (camera adapting to brightness)', () => {
    // Camera auto-exposure gradually adjusting over several seconds
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.33, // 80 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          // Exponential exposure adjustment (converging to target)
          const exposureShift = 0.4 * Math.exp(-t / 3);
          return {
            r: base.r * (1 + exposureShift),
            g: base.g * (1 + exposureShift),
            b: base.b * (1 + exposureShift),
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 80, 12);
  });

  it('handles camera warm-up drift (first few seconds unstable)', () => {
    // Sensor thermal drift in first 3 seconds causes color shift
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.5, // 90 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          const warmup = t < 3 ? 0.2 * (1 - t / 3) : 0; // fades over 3s
          return {
            r: base.r * (1 + warmup * 1.2),
            g: base.g * (1 + warmup * 0.5),
            b: base.b * (1 - warmup * 0.3),
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 90, 12);
  });

  it('processes minimum viable buffer (just over 3 seconds)', () => {
    // Edge case: smallest buffer that should produce a result
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 3.5,
        pulseHz: 1.2,
        pulseAmplitude: 0.04,
      }),
      30,
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result.bpm).toBeGreaterThan(40);
      expect(result.bpm).toBeLessThan(200);
    }
  });
});

// ─── Subject Variability ─────────────────────────────────────────────────────

describe('processRPPG: subject variability', () => {
  it('detects child heart rate (120 BPM / 2.0 Hz)', () => {
    // Children often have higher resting HR (80-160 BPM)
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 2.0, // 120 BPM (child)
        pulseAmplitude: 0.025,
      }),
      30,
    );
    expectBpmNear(result, 120, 15);
  });

  it('detects infant heart rate (140 BPM / 2.33 Hz)', () => {
    // Infants: 100-160 BPM typical
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 2.33, // 140 BPM
        pulseAmplitude: 0.02,
      }),
      30,
    );
    expectBpmNear(result, 140, 15);
  });

  it('detects athlete resting heart rate (48 BPM / 0.8 Hz)', () => {
    // Athletes can have very low resting HR near the bandpass lower edge
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 15, // longer buffer for low frequencies
        pulseHz: 0.8, // 48 BPM
        pulseAmplitude: 0.04,
      }),
      30,
    );
    expectBpmNear(result, 48, 12);
  });

  it('detects pulse with very dark skin tone (low SNR)', () => {
    // Melanin absorbs more light → lower pulse amplitude in all channels
    seed = 77;
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.008, // very low modulation
        skin: { r: 100, g: 70, b: 50 },
        perturb: (i, t, base) => ({
          r: base.r + seededGaussian(1.5),
          g: base.g + seededGaussian(1.5),
          b: base.b + seededGaussian(1.0),
        }),
      }),
      30,
    );
    expect(result).not.toBeNull();
    // Wider tolerance for very challenging signal
    if (result) {
      expect(result.bpm).toBeGreaterThan(45);
      expect(result.bpm).toBeLessThan(180);
    }
  });

  it('detects pulse with very light/fair skin tone (high SNR)', () => {
    // Fair skin → stronger visible pulse, especially in green channel
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.33, // 80 BPM
        pulseAmplitude: 0.05, // higher modulation
        skin: { r: 220, g: 190, b: 170 },
      }),
      30,
    );
    expectBpmNear(result, 80, 10);
  });

  it('handles exercise recovery (HR decreasing from ~150 to ~80 BPM)', () => {
    // Non-stationary heart rate: chirp-like signal
    const sampleRate = 30;
    const duration = 12;
    const n = sampleRate * duration;
    const samples: RGBSample[] = [];

    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      // HR decreases linearly from 150 to 80 BPM over 12 seconds
      const currentHz = (150 - (70 * t) / duration) / 60;
      // Integrate instantaneous frequency for correct phase
      const phase = 2 * Math.PI * ((150 / 60) * t - (70 / 60 / duration) * t * t / 2);
      const pulse = 0.03 * Math.sin(phase);

      samples.push({
        r: SKIN.r * (1 + pulse * 0.5),
        g: SKIN.g * (1 + pulse),
        b: SKIN.b * (1 + pulse * 0.3),
        timestamp: t * 1000,
      });
    }

    const result = processRPPG(samples, sampleRate);
    expect(result).not.toBeNull();
    if (result) {
      // Should detect *some* valid heart rate in the range
      expect(result.bpm).toBeGreaterThan(60);
      expect(result.bpm).toBeLessThan(170);
    }
  });

  it('handles talking/jaw movement artifact', () => {
    // Speaking creates periodic jaw motion at typical syllable rate (~3-5 Hz)
    // which overlaps with cardiac band — a tough scenario
    seed = 55;
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          // Intermittent speech-like motion (3 Hz, active for 2s intervals)
          const speaking = (Math.sin(2 * Math.PI * 0.2 * t) > 0) ? 1 : 0;
          const jawMotion = speaking * 0.02 * Math.sin(2 * Math.PI * 3.5 * t);
          return {
            r: base.r * (1 + jawMotion),
            g: base.g * (1 + jawMotion * 1.5),
            b: base.b * (1 + jawMotion * 0.8),
          };
        },
      }),
      30,
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result.bpm).toBeGreaterThan(45);
      expect(result.bpm).toBeLessThan(180);
    }
  });
});

// ─── Motion Scenarios ────────────────────────────────────────────────────────

describe('processRPPG: motion scenarios', () => {
  it('detects pulse with continuous fidgeting (small random movements)', () => {
    // Child or nervous subject making continuous small movements
    seed = 99;
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.5, // 90 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          // Small random brightness jitter from motion
          const jitter = seededGaussian(3);
          return {
            r: base.r + jitter,
            g: base.g + jitter * 0.8,
            b: base.b + jitter * 0.6,
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 90, 12);
  });

  it('detects pulse with slow head rotation (shadow boundary sweep)', () => {
    // Slow head turn causes gradual shadow shift across face
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          // 0.1 Hz head turn → shadow sweep
          const shadow = 0.2 * Math.sin(2 * Math.PI * 0.1 * t);
          // Asymmetric: affects R/G more than B (shadow color shift)
          return {
            r: base.r * (1 + shadow * 1.0),
            g: base.g * (1 + shadow * 0.8),
            b: base.b * (1 + shadow * 0.4),
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 72, 12);
  });

  it('detects pulse with child bouncing/swaying (~0.7 Hz)', () => {
    // Periodic motion near cardiac band edge — challenging case
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.5, // 90 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          // 0.7 Hz sway — right at bandpass lower edge
          const sway = 0.08 * Math.sin(2 * Math.PI * 0.7 * t);
          return {
            r: base.r * (1 + sway),
            g: base.g * (1 + sway),
            b: base.b * (1 + sway),
          };
        },
      }),
      30,
    );
    // 0.7 Hz motion may partially leak through, but 1.5 Hz pulse should dominate
    expect(result).not.toBeNull();
    if (result) {
      expect(result.bpm).toBeGreaterThan(45);
      expect(result.bpm).toBeLessThan(180);
    }
  });

  it('detects pulse with handheld phone camera shake', () => {
    // High-frequency random shake from hand tremor (8-12 Hz typical)
    seed = 200;
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.33, // 80 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          // Hand tremor: broadband high-frequency noise
          const shake = seededGaussian(4);
          return {
            r: base.r + shake,
            g: base.g + shake * 0.9,
            b: base.b + shake * 0.7,
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 80, 12);
  });

  it('detects pulse after sudden head jerk (transient motion artifact)', () => {
    // Single large motion event (looking away then back)
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          // Sharp jerk at t=5s lasting ~0.3s
          if (t > 5 && t < 5.3) {
            return {
              r: base.r * 0.3, // face partially out of frame
              g: base.g * 0.3,
              b: base.b * 0.3,
            };
          }
          return base;
        },
      }),
      30,
    );
    expectBpmNear(result, 72, 15);
  });
});

// ─── Compound/Adversarial Conditions ─────────────────────────────────────────

describe('processRPPG: compound adversarial conditions', () => {
  it('detects pulse: low light + motion + fluorescent flicker (worst case indoor)', () => {
    seed = 42;
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.02,
        skin: { r: 90, g: 70, b: 50 }, // low light
        perturb: (i, t, base) => {
          const flicker = 0.1 * (i % 2 === 0 ? 1 : -1);
          const motion = seededGaussian(3);
          return {
            r: Math.max(1, base.r * (1 + flicker) + motion),
            g: Math.max(1, base.g * (1 + flicker) + motion * 0.8),
            b: Math.max(1, base.b * (1 + flicker) + motion * 0.6),
          };
        },
      }),
      30,
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result.bpm).toBeGreaterThan(45);
      expect(result.bpm).toBeLessThan(180);
    }
  });

  it('detects pulse: dark skin + backlighting + camera noise', () => {
    seed = 88;
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.33, // 80 BPM
        pulseAmplitude: 0.008, // very weak from dark skin + backlighting
        skin: { r: 55, g: 40, b: 30 }, // dark skin + backlit = very dark
        perturb: (i, t, base) => ({
          r: Math.max(1, base.r + seededGaussian(5)),
          g: Math.max(1, base.g + seededGaussian(5)),
          b: Math.max(1, base.b + seededGaussian(4)),
        }),
      }),
      30,
    );
    // This is an extremely challenging scenario — we accept any non-crash result
    expect(result).not.toBeNull();
    if (result) {
      expect(Number.isFinite(result.bpm)).toBe(true);
      expect(Number.isFinite(result.confidence)).toBe(true);
    }
  });

  it('detects pulse: outdoor direct sunlight + wind-caused motion', () => {
    seed = 150;
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.5, // 90 BPM
        pulseAmplitude: 0.04, // stronger in direct sunlight
        skin: { r: 200, g: 160, b: 120 }, // brighter in sunlight
        perturb: (i, t, base) => {
          // Wind-caused hair/head motion: irregular low-freq
          const wind = seededGaussian(2) * Math.sin(2 * Math.PI * 0.3 * t);
          return {
            r: base.r + wind,
            g: base.g + wind * 0.8,
            b: base.b + wind * 0.5,
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 90, 12);
  });

  it('detects pulse: child + fidgeting + tablet front camera', () => {
    // Child (higher HR) on a tablet held on a table — slight device vibration + fidgeting
    seed = 333;
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.83, // 110 BPM (child)
        pulseAmplitude: 0.025,
        perturb: (i, t, base) => {
          const fidget = seededGaussian(2);
          // Occasional larger movements every ~3s
          const bigMove = (Math.abs(Math.sin(2 * Math.PI * 0.33 * t)) > 0.95) ? seededGaussian(8) : 0;
          return {
            r: base.r + fidget + bigMove,
            g: base.g + fidget * 0.9 + bigMove * 0.9,
            b: base.b + fidget * 0.7 + bigMove * 0.7,
          };
        },
      }),
      30,
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result.bpm).toBeGreaterThan(70);
      expect(result.bpm).toBeLessThan(150);
    }
  });

  it('handles intermittent face detection loss (face tracker dropouts)', () => {
    // Face detection drops out briefly every ~2s (common with fast head turns)
    // ROI color goes to background/noise during dropouts
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.2, // 72 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          // Drop to background color for 3-4 frames every ~2 seconds
          const cyclePos = (t % 2);
          if (cyclePos > 1.85 && cyclePos < 2.0) {
            return { r: 200, g: 200, b: 200 }; // wall/background color
          }
          return base;
        },
      }),
      30,
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(Number.isFinite(result.bpm)).toBe(true);
    }
  });

  it('handles gradual face zoom (approaching/receding from camera)', () => {
    // Face getting closer → ROI brightness changes as face fills more of frame
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 12,
        pulseHz: 1.33, // 80 BPM
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => {
          // Slow zoom: brightness increases 30% over 12 seconds
          const zoom = 1 + 0.3 * (t / 12);
          return {
            r: base.r * zoom,
            g: base.g * zoom,
            b: base.b * zoom,
          };
        },
      }),
      30,
    );
    expectBpmNear(result, 80, 12);
  });
});

// ─── BPM Smoothing Under Stress ──────────────────────────────────────────────

describe('processRPPG: BPM smoothing resilience', () => {
  it('EMA smoothing rejects single outlier measurement', () => {
    const state: BpmSmoothingState = { prevBpm: 72.0, posLowConfidenceCount: 0, emaCount: 0 };

    // Process a clean 72 BPM signal — should stay near 72
    const cleanSamples = makeSyntheticRGB({
      sampleRate: 30,
      durationSec: 10,
      pulseHz: 1.2,
      pulseAmplitude: 0.03,
    });
    const result = processRPPG(cleanSamples, 30, state);
    expect(result).not.toBeNull();
    if (result && result.confidence > 0.1) {
      // With EMA and prev=72, result should be close to 72
      expect(result.bpm).toBeGreaterThan(65);
      expect(result.bpm).toBeLessThan(80);
    }
  });

  it('EMA smoothing tracks gradual HR change', () => {
    const state = createBpmSmoothingState();

    // First measurement at 72 BPM
    const samples1 = makeSyntheticRGB({
      sampleRate: 30,
      durationSec: 10,
      pulseHz: 1.2,
      pulseAmplitude: 0.03,
    });
    const r1 = processRPPG(samples1, 30, state);
    expect(r1).not.toBeNull();

    // Second measurement at 90 BPM
    const samples2 = makeSyntheticRGB({
      sampleRate: 30,
      durationSec: 10,
      pulseHz: 1.5,
      pulseAmplitude: 0.03,
    });
    const r2 = processRPPG(samples2, 30, state);
    expect(r2).not.toBeNull();

    if (r1 && r2 && r1.confidence > 0.1 && r2.confidence > 0.1) {
      // r2 should be pulled toward r1's BPM by EMA, not jump fully to 90
      expect(r2.bpm).toBeLessThan(88);
    }
  });
});

// ─── POS Algorithm Robustness ────────────────────────────────────────────────

describe('posAlgorithm: robustness', () => {
  it('handles saturated (clipped) channels gracefully', () => {
    // Camera sensor saturation — R channel clips at 255
    const samples = makeSyntheticRGB({
      sampleRate: 30,
      durationSec: 8,
      pulseHz: 1.2,
      pulseAmplitude: 0.03,
      skin: { r: 250, g: 200, b: 170 }, // near-saturated skin
      perturb: (i, t, base) => ({
        r: Math.min(255, base.r), // clip at 255
        g: base.g,
        b: base.b,
      }),
    });
    const result = posAlgorithm(samples, 30);
    expect(result.length).toBe(samples.length);
    // Should not produce NaN or Infinity
    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  });

  it('handles near-zero channel values (extreme underexposure)', () => {
    const samples = makeSyntheticRGB({
      sampleRate: 30,
      durationSec: 8,
      pulseHz: 1.2,
      pulseAmplitude: 0.03,
      skin: { r: 5, g: 3, b: 2 }, // barely above zero
    });
    const result = posAlgorithm(samples, 30);
    expect(result.length).toBe(samples.length);
    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  });

  it('handles identical R/G/B channels (desaturated/monochrome camera)', () => {
    // Some IR cameras or very poor color cameras produce near-equal R=G=B
    const n = 300;
    const samples: RGBSample[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / 30;
      const pulse = 0.02 * Math.sin(2 * Math.PI * 1.2 * t);
      const v = 128 * (1 + pulse);
      samples.push({ r: v, g: v, b: v, timestamp: t * 1000 });
    }
    const result = posAlgorithm(samples, 30);
    // POS relies on channel differences — mono input → near-zero output
    expect(result.length).toBe(n);
    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  });

  it('handles abrupt skin tone change (different person enters frame)', () => {
    // Models scenario where face tracker locks onto a different person mid-measurement
    const n = 360;
    const samples: RGBSample[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / 30;
      const pulse = 0.03 * Math.sin(2 * Math.PI * 1.2 * t);
      // Person 1 (light skin) for first 6s, Person 2 (dark skin) for last 6s
      const skin = i < 180
        ? { r: 200, g: 160, b: 130 }
        : { r: 100, g: 70, b: 50 };
      samples.push({
        r: skin.r * (1 + pulse * 0.5),
        g: skin.g * (1 + pulse),
        b: skin.b * (1 + pulse * 0.3),
        timestamp: t * 1000,
      });
    }
    const result = posAlgorithm(samples, 30);
    expect(result.length).toBe(n);
    // Per-window normalization should adapt to the skin tone change
    for (let i = 0; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
    }
  });
});

// ─── Numerical Stability ─────────────────────────────────────────────────────

describe('processRPPG: numerical stability', () => {
  it('produces no NaN or Infinity values in output', () => {
    seed = 42;
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 10,
        pulseHz: 1.2,
        pulseAmplitude: 0.03,
        perturb: (i, t, base) => ({
          r: Math.max(0.001, base.r + seededGaussian(5)),
          g: Math.max(0.001, base.g + seededGaussian(5)),
          b: Math.max(0.001, base.b + seededGaussian(4)),
        }),
      }),
      30,
    );
    expect(result).not.toBeNull();
    if (!result) return;

    expect(Number.isFinite(result.bpm)).toBe(true);
    expect(Number.isFinite(result.confidence)).toBe(true);
    for (let i = 0; i < result.waveform.length; i++) {
      expect(Number.isFinite(result.waveform[i])).toBe(true);
    }
    for (let i = 0; i < result.spectrum.length; i++) {
      expect(Number.isFinite(result.spectrum[i])).toBe(true);
    }
  });

  it('handles all-identical samples without crashing', () => {
    const n = 300;
    const samples: RGBSample[] = [];
    for (let i = 0; i < n; i++) {
      samples.push({ r: 150, g: 120, b: 90, timestamp: (i / 30) * 1000 });
    }
    const result = processRPPG(samples, 30);
    // May return null or a result with 0 confidence — either is fine
    if (result) {
      expect(Number.isFinite(result.bpm)).toBe(true);
      expect(Number.isFinite(result.confidence)).toBe(true);
    }
  });

  it('handles extremely large RGB values (HDR/wide-gamut)', () => {
    const result = processRPPG(
      makeSyntheticRGB({
        sampleRate: 30,
        durationSec: 10,
        pulseHz: 1.2,
        pulseAmplitude: 0.03,
        skin: { r: 1000, g: 800, b: 600 }, // HDR values > 255
      }),
      30,
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(Number.isFinite(result.bpm)).toBe(true);
      expectBpmNear(result, 72, 12);
    }
  });
});
