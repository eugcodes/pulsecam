import { describe, it, expect } from 'vitest';
import {
  posAlgorithm,
  chromAlgorithm,
  processRPPG,
  createBpmSmoothingState,
  type RGBSample,
  type BpmSmoothingState,
} from './rppg';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate synthetic RGB samples with an embedded pulse signal.
 * Simulates skin reflection: base color + small sinusoidal modulation in G channel.
 */
function makeSyntheticRGB(
  sampleRate: number,
  durationSec: number,
  pulseHz: number,
  pulseAmplitude = 0.02,
): RGBSample[] {
  const n = Math.round(sampleRate * durationSec);
  const samples: RGBSample[] = [];

  // Base skin tone
  const baseR = 180;
  const baseG = 140;
  const baseB = 100;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // Pulse modulation (primarily in green channel, per Verkruysse et al. 2008)
    const pulse = pulseAmplitude * Math.sin(2 * Math.PI * pulseHz * t);

    samples.push({
      r: baseR * (1 + pulse * 0.5),
      g: baseG * (1 + pulse),
      b: baseB * (1 + pulse * 0.3),
      timestamp: t * 1000, // ms
    });
  }
  return samples;
}

/** Generate constant-color RGB samples (no pulse). */
function makeConstantRGB(
  sampleRate: number,
  durationSec: number,
): RGBSample[] {
  const n = Math.round(sampleRate * durationSec);
  const samples: RGBSample[] = [];
  for (let i = 0; i < n; i++) {
    samples.push({
      r: 150,
      g: 120,
      b: 90,
      timestamp: (i / sampleRate) * 1000,
    });
  }
  return samples;
}

// ─── posAlgorithm ────────────────────────────────────────────────────────────

describe('posAlgorithm', () => {
  it('returns empty array for fewer than 3 samples', () => {
    const result = posAlgorithm([], 30);
    expect(result.length).toBe(0);

    const result2 = posAlgorithm(
      [{ r: 1, g: 1, b: 1, timestamp: 0 }, { r: 1, g: 1, b: 1, timestamp: 33 }],
      30,
    );
    expect(result2.length).toBe(0);
  });

  it('returns array of same length as input', () => {
    const samples = makeSyntheticRGB(30, 5, 1.2);
    const result = posAlgorithm(samples, 30);
    expect(result.length).toBe(samples.length);
    expect(result).toBeInstanceOf(Float64Array);
  });

  it('produces non-zero output for varying input', () => {
    const samples = makeSyntheticRGB(30, 5, 1.2);
    const result = posAlgorithm(samples, 30);

    // At least some samples should be non-zero
    const maxAbs = Math.max(...Array.from(result).map(Math.abs));
    expect(maxAbs).toBeGreaterThan(0);
  });

  it('produces near-zero output for constant-color input', () => {
    const samples = makeConstantRGB(30, 5);
    const result = posAlgorithm(samples, 30);

    // Constant color → no variation → S1=S2=0 → result ≈ 0
    const maxAbs = Math.max(...Array.from(result).map(Math.abs));
    expect(maxAbs).toBeLessThan(1e-6);
  });

  it('uses per-window normalization (single mean per window)', () => {
    // Create samples with a step change in brightness
    // Under per-window normalization, each window has its own mean.
    const sampleRate = 30;
    const n = 300;
    const samples: RGBSample[] = [];

    for (let i = 0; i < n; i++) {
      const brightness = i < 150 ? 100 : 200; // step change
      const pulse = 0.02 * Math.sin(2 * Math.PI * 1.2 * i / sampleRate);
      samples.push({
        r: brightness * (1 + pulse * 0.5),
        g: brightness * (1 + pulse),
        b: brightness * (1 + pulse * 0.3),
        timestamp: (i / sampleRate) * 1000,
      });
    }

    const result = posAlgorithm(samples, sampleRate);

    // Both halves should have signal (normalization adapts to brightness change)
    const firstHalf = result.slice(0, 120);
    const secondHalf = result.slice(180, 300);

    const firstMax = Math.max(...Array.from(firstHalf).map(Math.abs));
    const secondMax = Math.max(...Array.from(secondHalf).map(Math.abs));

    expect(firstMax).toBeGreaterThan(0);
    expect(secondMax).toBeGreaterThan(0);
  });

  it('mean-subtracts each window (DC-free output)', () => {
    const samples = makeSyntheticRGB(30, 5, 1.5);
    const result = posAlgorithm(samples, 30);

    // Overall mean should be near zero (each window's h is mean-subtracted)
    let sum = 0;
    for (let i = 0; i < result.length; i++) sum += result[i];
    const resultMean = sum / result.length;
    expect(Math.abs(resultMean)).toBeLessThan(0.01);
  });

  it('skips windows with near-zero channel means', () => {
    const samples: RGBSample[] = [];
    for (let i = 0; i < 100; i++) {
      samples.push({ r: 0, g: 0, b: 0, timestamp: i * 33 });
    }

    const result = posAlgorithm(samples, 30);

    // All zeros should produce all-zero output (skip all windows)
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(0);
    }
  });
});

// ─── processRPPG ─────────────────────────────────────────────────────────────

describe('processRPPG', () => {
  it('returns null for insufficient data (< 2 seconds)', () => {
    const samples = makeSyntheticRGB(30, 1, 1.2); // only 1 second
    const result = processRPPG(samples, 30);
    expect(result).toBeNull();
  });

  it('returns a valid PulseResult for sufficient data', () => {
    const samples = makeSyntheticRGB(30, 10, 1.2);
    const result = processRPPG(samples, 30);

    expect(result).not.toBeNull();
    if (!result) return;

    expect(typeof result.bpm).toBe('number');
    expect(typeof result.confidence).toBe('number');
    expect(result.waveform).toBeInstanceOf(Float64Array);
    expect(result.rawSignal).toBeInstanceOf(Float64Array);
    expect(result.spectrum).toBeInstanceOf(Float64Array);
    expect(result.sampleRate).toBe(30);
  });

  it('detects ~72 BPM (1.2 Hz) from synthetic pulse data', () => {
    const pulseHz = 1.2; // 72 BPM
    const samples = makeSyntheticRGB(30, 12, pulseHz, 0.03);
    const result = processRPPG(samples, 30);

    expect(result).not.toBeNull();
    if (!result) return;

    // BPM should be within ±10 of true value
    expect(result.bpm).toBeGreaterThan(62);
    expect(result.bpm).toBeLessThan(82);
  });

  it('detects ~90 BPM (1.5 Hz) from synthetic pulse data', () => {
    const pulseHz = 1.5; // 90 BPM
    const samples = makeSyntheticRGB(30, 12, pulseHz, 0.03);
    const result = processRPPG(samples, 30);

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.bpm).toBeGreaterThan(80);
    expect(result.bpm).toBeLessThan(100);
  });

  it('produces confidence between 0 and 1', () => {
    const samples = makeSyntheticRGB(30, 10, 1.2);
    const result = processRPPG(samples, 30);

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('BPM is rounded to one decimal place', () => {
    const samples = makeSyntheticRGB(30, 10, 1.2);
    const result = processRPPG(samples, 30);

    expect(result).not.toBeNull();
    if (!result) return;

    // Check it's rounded to 1 decimal
    const bpmStr = result.bpm.toString();
    const decimalIdx = bpmStr.indexOf('.');
    if (decimalIdx !== -1) {
      expect(bpmStr.length - decimalIdx - 1).toBeLessThanOrEqual(1);
    }
  });

  it('waveform has zero mean and unit variance', () => {
    const samples = makeSyntheticRGB(30, 10, 1.2, 0.03);
    const result = processRPPG(samples, 30);

    expect(result).not.toBeNull();
    if (!result) return;

    const wf = result.waveform;
    let m = 0;
    for (let i = 0; i < wf.length; i++) m += wf[i];
    m /= wf.length;

    let v = 0;
    for (let i = 0; i < wf.length; i++) v += (wf[i] - m) ** 2;
    v /= wf.length;
    const s = Math.sqrt(v);

    expect(Math.abs(m)).toBeLessThan(1e-6);
    expect(s).toBeCloseTo(1, 3);
  });
});

// ─── BPM Smoothing ───────────────────────────────────────────────────────────

describe('BPM smoothing', () => {
  it('createBpmSmoothingState returns null prevBpm', () => {
    const state = createBpmSmoothingState();
    expect(state.prevBpm).toBeNull();
  });

  it('first call with smoothing sets prevBpm (no averaging)', () => {
    const state = createBpmSmoothingState();
    const samples = makeSyntheticRGB(30, 10, 1.2, 0.03);

    const result = processRPPG(samples, 30, state);
    expect(result).not.toBeNull();

    // First call: no previous BPM to average with, so prevBpm should now be set
    if (result && result.confidence > 0.1) {
      expect(state.prevBpm).not.toBeNull();
    }
  });

  it('subsequent calls smooth BPM via EMA', () => {
    const state: BpmSmoothingState = { prevBpm: 72.0, posLowConfidenceCount: 0, emaCount: 0 };

    // Process with a signal at ~90 BPM
    const samples = makeSyntheticRGB(30, 10, 1.5, 0.03);
    const result = processRPPG(samples, 30, state);

    expect(result).not.toBeNull();
    if (!result || result.confidence <= 0.1) return;

    // With EMA (alpha=0.25), result should be pulled toward 72
    // smoothed = 0.25 * raw + 0.75 * 72
    // If raw ≈ 90, smoothed ≈ 0.25*90 + 0.75*72 = 76.5
    // So it should be between 72 and 90
    expect(result.bpm).toBeGreaterThan(70);
    expect(result.bpm).toBeLessThan(95);
  });

  it('does not update prevBpm when confidence is low', () => {
    // Use constant color → zero signal → low confidence
    const state: BpmSmoothingState = { prevBpm: 72.0, posLowConfidenceCount: 0, emaCount: 0 };
    const samples = makeConstantRGB(30, 10);
    const result = processRPPG(samples, 30, state);

    // Should not modify prevBpm since confidence will be ~0
    if (result && result.confidence <= 0.1) {
      expect(state.prevBpm).toBe(72.0);
    }
  });

  it('works without smoothingState (backward compatible)', () => {
    const samples = makeSyntheticRGB(30, 10, 1.2, 0.03);

    // Should not throw when smoothingState is undefined
    const result = processRPPG(samples, 30);
    expect(result).not.toBeNull();
  });
});

// ─── Integration: full pipeline properties ───────────────────────────────────

describe('processRPPG integration', () => {
  it('different pulse rates produce different BPM outputs', () => {
    const slow = makeSyntheticRGB(30, 12, 1.0, 0.03); // 60 BPM
    const fast = makeSyntheticRGB(30, 12, 2.0, 0.03); // 120 BPM

    const resultSlow = processRPPG(slow, 30);
    const resultFast = processRPPG(fast, 30);

    expect(resultSlow).not.toBeNull();
    expect(resultFast).not.toBeNull();
    if (!resultSlow || !resultFast) return;

    // Fast should be clearly higher BPM than slow
    expect(resultFast.bpm).toBeGreaterThan(resultSlow.bpm + 20);
  });

  it('handles different sample rates', () => {
    // 25 fps (some webcams)
    const samples25 = makeSyntheticRGB(25, 12, 1.2, 0.03);
    const result25 = processRPPG(samples25, 25);
    expect(result25).not.toBeNull();
    if (result25) {
      expect(result25.bpm).toBeGreaterThan(60);
      expect(result25.bpm).toBeLessThan(84);
    }
  });

  it('spectrum length is consistent with FFT size', () => {
    const samples = makeSyntheticRGB(30, 10, 1.2, 0.03);
    const result = processRPPG(samples, 30);

    expect(result).not.toBeNull();
    if (!result) return;

    // Spectrum should be N/2 where N is next power of 2 >= sample count
    const N = result.rawSignal.length;
    let nfft = 1;
    while (nfft < N) nfft <<= 1;
    expect(result.spectrum.length).toBe(nfft / 2);
  });
});

// ─── chromAlgorithm ───────────────────────────────────────────────────────────

describe('chromAlgorithm', () => {
  it('returns empty array for fewer than 3 samples', () => {
    expect(chromAlgorithm([], 30).length).toBe(0);
    expect(chromAlgorithm([{ r: 1, g: 1, b: 1, timestamp: 0 }], 30).length).toBe(0);
  });

  it('returns array of same length as input', () => {
    const samples = makeSyntheticRGB(30, 5, 1.2);
    const result = chromAlgorithm(samples, 30);
    expect(result.length).toBe(samples.length);
    expect(result).toBeInstanceOf(Float64Array);
  });

  it('produces non-zero output for varying input', () => {
    const samples = makeSyntheticRGB(30, 5, 1.2);
    const result = chromAlgorithm(samples, 30);
    const maxAbs = Math.max(...Array.from(result).map(Math.abs));
    expect(maxAbs).toBeGreaterThan(0);
  });

  it('produces near-zero output for constant-color input', () => {
    const samples = makeConstantRGB(30, 5);
    const result = chromAlgorithm(samples, 30);
    const maxAbs = Math.max(...Array.from(result).map(Math.abs));
    expect(maxAbs).toBeLessThan(1e-6);
  });

  it('skips windows with near-zero channel means', () => {
    const samples: RGBSample[] = [];
    for (let i = 0; i < 100; i++) {
      samples.push({ r: 0, g: 0, b: 0, timestamp: i * 33 });
    }
    const result = chromAlgorithm(samples, 30);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(0);
    }
  });

  it('produces a different signal from POS for the same input', () => {
    const samples = makeSyntheticRGB(30, 5, 1.2, 0.03);
    const posResult = posAlgorithm(samples, 30);
    const chromResult = chromAlgorithm(samples, 30);

    // Both should be non-zero
    const posMax = Math.max(...Array.from(posResult).map(Math.abs));
    const chromMax = Math.max(...Array.from(chromResult).map(Math.abs));
    expect(posMax).toBeGreaterThan(0);
    expect(chromMax).toBeGreaterThan(0);

    // They should not be identical (different projection coefficients)
    let identical = true;
    for (let i = 0; i < posResult.length; i++) {
      if (Math.abs(posResult[i] - chromResult[i]) > 1e-10) {
        identical = false;
        break;
      }
    }
    expect(identical).toBe(false);
  });
});

// ─── CHROM fallback mechanism ─────────────────────────────────────────────────

describe('CHROM fallback', () => {
  it('uses POS when POS confidence is adequate', () => {
    const state = createBpmSmoothingState();
    const samples = makeSyntheticRGB(30, 10, 1.2, 0.03);

    const result = processRPPG(samples, 30, state);
    expect(result).not.toBeNull();
    if (!result) return;

    // POS works well on clean data — counter should stay at 0 or reset
    expect(state.posLowConfidenceCount).toBe(0);
  });

  it('increments posLowConfidenceCount on low-confidence POS', () => {
    const state = createBpmSmoothingState();

    // Constant color → zero signal → low POS confidence
    const samples = makeConstantRGB(30, 10);
    processRPPG(samples, 30, state);

    expect(state.posLowConfidenceCount).toBeGreaterThan(0);
  });

  it('resets posLowConfidenceCount when POS recovers', () => {
    const state = createBpmSmoothingState();

    // First: low confidence
    const badSamples = makeConstantRGB(30, 10);
    processRPPG(badSamples, 30, state);
    expect(state.posLowConfidenceCount).toBeGreaterThan(0);

    // Second: good confidence — counter should reset
    const goodSamples = makeSyntheticRGB(30, 10, 1.2, 0.03);
    processRPPG(goodSamples, 30, state);
    expect(state.posLowConfidenceCount).toBe(0);
  });

  it('still produces valid output without smoothingState (no fallback tracking)', () => {
    const samples = makeSyntheticRGB(30, 10, 1.2, 0.03);
    // Without smoothingState, CHROM fallback logic is skipped, POS always used
    const result = processRPPG(samples, 30);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.bpm).toBeGreaterThan(62);
    expect(result.bpm).toBeLessThan(82);
  });

  it('createBpmSmoothingState initializes posLowConfidenceCount to 0', () => {
    const state = createBpmSmoothingState();
    expect(state.posLowConfidenceCount).toBe(0);
    expect(state.prevBpm).toBeNull();
  });
});
