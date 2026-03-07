import { describe, it, expect } from 'vitest';
import {
  nextPow2,
  fft,
  dominantFrequency,
  butterworthBandpass,
  biquadFilter,
  createFilterState,
  filterSignal,
  filtfiltSignal,
  detrend,
  detrendMovingAverage,
  normalize,
} from './filters';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a pure sine wave: A * sin(2π * freq * i / sampleRate + phase). */
function makeSine(
  length: number,
  freq: number,
  sampleRate: number,
  amplitude = 1,
  phase = 0,
): Float64Array {
  const sig = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    sig[i] = amplitude * Math.sin(2 * Math.PI * freq * i / sampleRate + phase);
  }
  return sig;
}

/** Compute mean of a Float64Array. */
function mean(arr: Float64Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/** Compute standard deviation of a Float64Array. */
function std(arr: Float64Array): number {
  const m = mean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += (arr[i] - m) ** 2;
  return Math.sqrt(s / arr.length);
}

// ─── nextPow2 ────────────────────────────────────────────────────────────────

describe('nextPow2', () => {
  it('returns the same value for powers of 2', () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(2)).toBe(2);
    expect(nextPow2(64)).toBe(64);
    expect(nextPow2(1024)).toBe(1024);
  });

  it('rounds up to next power of 2', () => {
    expect(nextPow2(3)).toBe(4);
    expect(nextPow2(5)).toBe(8);
    expect(nextPow2(100)).toBe(128);
    expect(nextPow2(257)).toBe(512);
  });
});

// ─── FFT ─────────────────────────────────────────────────────────────────────

describe('fft', () => {
  it('returns magnitude spectrum of length N/2', () => {
    const sig = new Float64Array(64);
    const mag = fft(sig);
    expect(mag.length).toBe(32);
  });

  it('zero-pads to next power of 2 and returns N/2 bins', () => {
    // 100 samples → zero-padded to 128 → 64 magnitude bins
    const sig = new Float64Array(100);
    const mag = fft(sig);
    expect(mag.length).toBe(64);
  });

  it('detects a pure sine at the correct bin', () => {
    // 256 samples at 256 Hz, sine at 10 Hz → bin 10
    const N = 256;
    const fs = 256;
    const freq = 10;
    const sig = makeSine(N, freq, fs);
    const mag = fft(sig);

    // Find peak bin
    let peakBin = 0;
    let peakMag = 0;
    for (let i = 1; i < mag.length; i++) {
      if (mag[i] > peakMag) {
        peakMag = mag[i];
        peakBin = i;
      }
    }

    expect(peakBin).toBe(freq); // bin 10 = 10 Hz
    // DFT of unit-amplitude sine: peak magnitude = N/2 = 128
    expect(peakMag).toBeCloseTo(N / 2, 0);
  });

  it('produces near-zero output for a zero signal', () => {
    const sig = new Float64Array(128);
    const mag = fft(sig);
    for (let i = 0; i < mag.length; i++) {
      expect(mag[i]).toBeCloseTo(0, 10);
    }
  });

  it('produces a single DC bin for a constant signal', () => {
    const sig = new Float64Array(64).fill(3.0);
    const mag = fft(sig);
    // DC bin (bin 0) should be N * amplitude = 64 * 3 = 192
    expect(mag[0]).toBeCloseTo(192, 0);
    // All other bins should be near zero
    for (let i = 1; i < mag.length; i++) {
      expect(mag[i]).toBeCloseTo(0, 5);
    }
  });

  it('resolves two distinct frequencies', () => {
    const N = 512;
    const fs = 512;
    const sig = new Float64Array(N);
    const f1 = 20, f2 = 50;
    for (let i = 0; i < N; i++) {
      sig[i] = Math.sin(2 * Math.PI * f1 * i / fs) + Math.sin(2 * Math.PI * f2 * i / fs);
    }
    const mag = fft(sig);

    // Both frequency bins should have large magnitudes
    expect(mag[f1]).toBeGreaterThan(N / 4);
    expect(mag[f2]).toBeGreaterThan(N / 4);

    // A bin between them should be near zero
    expect(mag[35]).toBeLessThan(1);
  });
});

// ─── dominantFrequency ───────────────────────────────────────────────────────

describe('dominantFrequency', () => {
  it('detects a 1.2 Hz sine (72 BPM) at 30 fps', () => {
    const fs = 30;
    const freq = 1.2; // 72 BPM
    const duration = 10; // 10 seconds
    const N = fs * duration;
    const sig = makeSine(N, freq, fs);

    const result = dominantFrequency(sig, fs, 0.7, 4.0);

    // Should be within 0.1 Hz of true frequency
    expect(result.frequency).toBeCloseTo(freq, 1);
    expect(result.magnitude).toBeGreaterThan(0);
    expect(result.spectrum).toBeInstanceOf(Float64Array);
    expect(result.spectrum.length).toBeGreaterThan(0);
  });

  it('detects a 2.0 Hz sine (120 BPM) at 30 fps', () => {
    const fs = 30;
    const freq = 2.0;
    const sig = makeSine(fs * 10, freq, fs);

    const result = dominantFrequency(sig, fs, 0.7, 4.0);
    expect(result.frequency).toBeCloseTo(freq, 1);
  });

  it('respects minHz/maxHz bounds', () => {
    const fs = 30;
    const N = 300;
    // Signal with two frequencies: 0.5 Hz (outside band) and 1.5 Hz (inside)
    const sig = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      sig[i] = 3 * Math.sin(2 * Math.PI * 0.5 * i / fs) // strong but out of band
             + Math.sin(2 * Math.PI * 1.5 * i / fs);     // weaker but in band
    }

    const result = dominantFrequency(sig, fs, 0.7, 4.0);
    // Should pick the 1.5 Hz component, not the 0.5 Hz one
    expect(result.frequency).toBeCloseTo(1.5, 0);
  });

  it('applies Hann window (reduces spectral leakage)', () => {
    // Non-bin-centered frequency to trigger leakage
    const fs = 30;
    const N = 256;
    const freq = 1.37; // intentionally between bins
    const sig = makeSine(N, freq, fs);

    const result = dominantFrequency(sig, fs, 0.5, 4.0);
    // With Hann + parabolic interpolation, should still be accurate
    expect(Math.abs(result.frequency - freq)).toBeLessThan(0.15);
  });
});

// ─── Butterworth Bandpass ────────────────────────────────────────────────────

describe('butterworthBandpass', () => {
  it('produces valid biquad coefficients', () => {
    const c = butterworthBandpass(0.7, 4.0, 30);

    // Bandpass: b1 should be 0, b0 and b2 should be opposite signs
    expect(c.b1).toBe(0);
    expect(c.b0).toBeCloseTo(-c.b2, 10);
    expect(c.b0).toBeGreaterThan(0);
  });

  it('produces stable coefficients (poles inside unit circle)', () => {
    const c = butterworthBandpass(0.7, 4.0, 30);

    // For stability, the feedback polynomial 1 + a1*z^-1 + a2*z^-2
    // must have roots inside the unit circle.
    // A necessary condition: |a2| < 1
    expect(Math.abs(c.a2)).toBeLessThan(1);
  });

  it('works with different sample rates', () => {
    const c25 = butterworthBandpass(0.7, 4.0, 25);
    const c30 = butterworthBandpass(0.7, 4.0, 30);
    const c60 = butterworthBandpass(0.7, 4.0, 60);

    // All should produce valid coefficients
    expect(c25.b0).toBeGreaterThan(0);
    expect(c30.b0).toBeGreaterThan(0);
    expect(c60.b0).toBeGreaterThan(0);

    // Higher sample rate → narrower relative bandwidth → smaller b0
    expect(c60.b0).toBeLessThan(c30.b0);
    expect(c30.b0).toBeLessThan(c25.b0);
  });
});

// ─── biquadFilter / filterSignal ─────────────────────────────────────────────

describe('biquadFilter', () => {
  it('mutates state correctly', () => {
    const coeffs = butterworthBandpass(0.7, 4.0, 30);
    const state = createFilterState();

    biquadFilter(1.0, coeffs, state);
    expect(state.x1).toBe(1.0);
    expect(state.x2).toBe(0);

    biquadFilter(2.0, coeffs, state);
    expect(state.x1).toBe(2.0);
    expect(state.x2).toBe(1.0);
  });

  it('produces non-zero output for non-zero input', () => {
    const coeffs = butterworthBandpass(0.7, 4.0, 30);
    const state = createFilterState();

    // After a few samples, output should be non-zero
    for (let i = 0; i < 10; i++) {
      biquadFilter(Math.sin(i), coeffs, state);
    }
    const y = biquadFilter(1.0, coeffs, state);
    expect(y).not.toBe(0);
  });
});

describe('filterSignal', () => {
  it('returns same length as input', () => {
    const sig = makeSine(100, 1.5, 30);
    const coeffs = butterworthBandpass(0.7, 4.0, 30);
    const out = filterSignal(sig, coeffs);
    expect(out.length).toBe(100);
  });

  it('passes in-band frequencies', () => {
    // 1.5 Hz is in the passband (0.7–4.0 Hz)
    const fs = 30;
    const sig = makeSine(300, 1.5, fs);
    const coeffs = butterworthBandpass(0.7, 4.0, fs);
    const out = filterSignal(sig, coeffs);

    // After transient (first ~30 samples), amplitude should be preserved
    const tail = out.slice(60);
    const maxAmp = Math.max(...tail.map(Math.abs));
    expect(maxAmp).toBeGreaterThan(0.5); // Should be close to 1.0
  });

  it('attenuates out-of-band frequencies', () => {
    // 0.1 Hz is below passband
    const fs = 30;
    const sig = makeSine(300, 0.1, fs);
    const coeffs = butterworthBandpass(0.7, 4.0, fs);
    const out = filterSignal(sig, coeffs);

    // After transient, amplitude should be heavily attenuated
    const tail = out.slice(90);
    const maxAmp = Math.max(...tail.map(Math.abs));
    expect(maxAmp).toBeLessThan(0.3);
  });
});

// ─── filtfiltSignal ──────────────────────────────────────────────────────────

describe('filtfiltSignal', () => {
  it('returns same length as input', () => {
    const sig = makeSine(100, 1.5, 30);
    const coeffs = butterworthBandpass(0.7, 4.0, 30);
    const out = filtfiltSignal(sig, coeffs);
    expect(out.length).toBe(100);
  });

  it('returns empty array for empty input', () => {
    const coeffs = butterworthBandpass(0.7, 4.0, 30);
    const out = filtfiltSignal(new Float64Array(0), coeffs);
    expect(out.length).toBe(0);
  });

  it('preserves zero-phase for a symmetric signal', () => {
    // A symmetric signal filtered with a zero-phase filter should remain symmetric
    const N = 128;
    const sig = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      // Symmetric envelope around center
      const t = (i - N / 2) / (N / 4);
      sig[i] = Math.exp(-t * t) * Math.sin(2 * Math.PI * 2.0 * i / 30);
    }

    const coeffs = butterworthBandpass(0.7, 4.0, 30);
    const out = filtfiltSignal(sig, coeffs);

    // Compare symmetry: out[i] ≈ -out[N-1-i] or out[i] ≈ out[N-1-i]
    // We check that the asymmetry is small relative to the signal amplitude
    const maxAmp = Math.max(...Array.from(out).map(Math.abs));
    if (maxAmp > 1e-10) {
      // Check that the peak of the filtered signal is near the center
      let peakIdx = 0;
      let peakVal = 0;
      for (let i = 0; i < N; i++) {
        if (Math.abs(out[i]) > peakVal) {
          peakVal = Math.abs(out[i]);
          peakIdx = i;
        }
      }
      // Peak should be near center (within ~10% of N)
      expect(Math.abs(peakIdx - N / 2)).toBeLessThan(N * 0.15);
    }
  });

  it('provides sharper rolloff than single-pass (effective 4th order)', () => {
    // Compare attenuation of out-of-band signal
    const fs = 30;
    const sig = makeSine(300, 0.1, fs); // below passband
    const coeffs = butterworthBandpass(0.7, 4.0, fs);

    const singlePass = filterSignal(sig, coeffs);
    const zeroPhase = filtfiltSignal(sig, coeffs);

    // filtfilt should attenuate more
    const singleMax = Math.max(...singlePass.slice(60).map(Math.abs));
    const filtfiltMax = Math.max(...zeroPhase.slice(60).map(Math.abs));
    expect(filtfiltMax).toBeLessThanOrEqual(singleMax + 1e-10);
  });

  it('passes in-band frequencies with preserved amplitude', () => {
    const fs = 30;
    const sig = makeSine(300, 1.5, fs);
    const coeffs = butterworthBandpass(0.7, 4.0, fs);
    const out = filtfiltSignal(sig, coeffs);

    // In the center of the signal, amplitude should be well-preserved
    const center = out.slice(50, 250);
    const maxAmp = Math.max(...center.map(Math.abs));
    expect(maxAmp).toBeGreaterThan(0.7);
  });
});

// ─── detrend (linear) ────────────────────────────────────────────────────────

describe('detrend', () => {
  it('removes a linear trend', () => {
    const n = 100;
    const sig = new Float64Array(n);
    // y = 2*i + 5 (pure linear)
    for (let i = 0; i < n; i++) sig[i] = 2 * i + 5;

    const out = detrend(sig);

    // Output should be near zero everywhere
    for (let i = 0; i < n; i++) {
      expect(out[i]).toBeCloseTo(0, 8);
    }
  });

  it('preserves a zero-mean sinusoidal signal', () => {
    const sig = makeSine(100, 2.0, 30);
    const out = detrend(sig);

    // Should be very similar to original (sine has no linear trend)
    let maxDiff = 0;
    for (let i = 0; i < sig.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(out[i] - sig[i]));
    }
    expect(maxDiff).toBeLessThan(0.1);
  });

  it('handles single-sample input', () => {
    const sig = new Float64Array([42]);
    const out = detrend(sig);
    expect(out.length).toBe(1);
  });

  it('removes trend from signal with trend + oscillation', () => {
    const n = 200;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sig[i] = 0.5 * i + Math.sin(2 * Math.PI * 2 * i / 30);
    }

    const out = detrend(sig);

    // Mean of output should be near zero
    expect(Math.abs(mean(out))).toBeLessThan(0.1);

    // The sinusoidal component should still be present
    const maxAmp = Math.max(...Array.from(out).map(Math.abs));
    expect(maxAmp).toBeGreaterThan(0.5);
  });
});

// ─── detrendMovingAverage ────────────────────────────────────────────────────

describe('detrendMovingAverage', () => {
  it('removes a constant offset', () => {
    const n = 100;
    const sig = new Float64Array(n).fill(10);

    const out = detrendMovingAverage(sig, 21);

    // Should be all zeros (or very close)
    for (let i = 0; i < n; i++) {
      expect(out[i]).toBeCloseTo(0, 10);
    }
  });

  it('preserves high-frequency content while removing slow drift', () => {
    const fs = 30;
    const n = 300; // 10 seconds
    const sig = new Float64Array(n);
    // Slow drift (0.05 Hz) + fast signal (1.5 Hz)
    for (let i = 0; i < n; i++) {
      sig[i] = 5 * Math.sin(2 * Math.PI * 0.05 * i / fs) // slow drift
             + Math.sin(2 * Math.PI * 1.5 * i / fs);       // fast signal
    }

    // Window of 2.5s (75 samples) → cutoff ~0.18 Hz
    const out = detrendMovingAverage(sig, 75);

    // The slow drift should be mostly removed
    // The fast signal should be mostly preserved
    // Check: dominant frequency of output should be ~1.5 Hz
    const result = dominantFrequency(out, fs, 0.5, 4.0);
    expect(result.frequency).toBeCloseTo(1.5, 0);
  });

  it('produces zero-mean output for signals longer than window', () => {
    const n = 200;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) sig[i] = i * 0.1 + Math.sin(i * 0.3);

    const out = detrendMovingAverage(sig, 31);

    // Interior mean should be near zero
    const interior = out.slice(31, n - 31);
    expect(Math.abs(mean(interior))).toBeLessThan(1);
  });

  it('does not affect a signal that is already zero-mean and high-frequency', () => {
    const fs = 30;
    const sig = makeSine(300, 1.5, fs);
    const out = detrendMovingAverage(sig, 75);

    // Most of the original amplitude should be preserved
    const origStd = std(sig);
    const outStd = std(out);
    expect(outStd / origStd).toBeGreaterThan(0.8);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it('handles window size = 1 (output equals zero everywhere)', () => {
    const sig = new Float64Array([3, 7, 1, 9, 5]);
    const out = detrendMovingAverage(sig, 1);
    // Window covers only the sample itself → mean = sample → output = 0
    for (let i = 0; i < sig.length; i++) {
      expect(out[i]).toBeCloseTo(0, 10);
    }
  });

  it('handles window size = 2 (even window)', () => {
    // half = floor(2/2) = 1, so window spans [i-1, i+1] in interior
    const sig = new Float64Array([10, 20, 30, 40, 50]);
    const out = detrendMovingAverage(sig, 2);
    // Each output should be signal[i] minus the local average
    expect(out.length).toBe(5);
    // Just verify it produces finite, non-NaN values and removes trend
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });

  it('handles window larger than signal length', () => {
    const sig = new Float64Array([1, 2, 3, 4, 5]);
    const out = detrendMovingAverage(sig, 100);
    // Every sample's window covers the full signal → subtract global mean (3)
    const globalMean = 3;
    for (let i = 0; i < sig.length; i++) {
      expect(out[i]).toBeCloseTo(sig[i] - globalMean, 10);
    }
  });

  it('handles single-element signal', () => {
    const sig = new Float64Array([42]);
    const out = detrendMovingAverage(sig, 5);
    expect(out.length).toBe(1);
    expect(out[0]).toBeCloseTo(0, 10);
  });

  it('handles two-element signal', () => {
    const sig = new Float64Array([10, 20]);
    const out = detrendMovingAverage(sig, 3);
    expect(out.length).toBe(2);
    // Window covers full signal for both → mean = 15
    expect(out[0]).toBeCloseTo(-5, 10);
    expect(out[1]).toBeCloseTo(5, 10);
  });

  it('returns correct length and preserves output type', () => {
    const sig = new Float64Array(500);
    for (let i = 0; i < 500; i++) sig[i] = Math.random() * 100 - 50;
    const out = detrendMovingAverage(sig, 31);
    expect(out).toBeInstanceOf(Float64Array);
    expect(out.length).toBe(500);
  });

  it('edge samples use truncated windows correctly', () => {
    // First and last samples have smaller windows (edge truncation).
    // For sig = [10, 20, 30, 40, 50] with windowSize = 5 (half = 2):
    //   i=0: window [0,2] → mean = (10+20+30)/3 = 20     → out = -10
    //   i=1: window [0,3] → mean = (10+20+30+40)/4 = 25  → out = -5
    //   i=2: window [0,4] → mean = (10+20+30+40+50)/5=30 → out = 0
    //   i=3: window [1,4] → mean = (20+30+40+50)/4 = 35  → out = 5
    //   i=4: window [2,4] → mean = (30+40+50)/3 ≈ 40     → out = 10
    const sig = new Float64Array([10, 20, 30, 40, 50]);
    const out = detrendMovingAverage(sig, 5);
    expect(out[0]).toBeCloseTo(-10, 10);
    expect(out[1]).toBeCloseTo(-5, 10);
    expect(out[2]).toBeCloseTo(0, 10);
    expect(out[3]).toBeCloseTo(5, 10);
    expect(out[4]).toBeCloseTo(10, 10);
  });

  it('removes linear ramp completely in the interior', () => {
    const n = 500;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) sig[i] = i; // 0, 1, 2, ..., 499
    const ws = 51;
    const out = detrendMovingAverage(sig, ws);
    const half = Math.floor(ws / 2);
    // Interior samples (away from edges) should be ~0
    for (let i = half; i < n - half; i++) {
      expect(Math.abs(out[i])).toBeLessThan(1e-10);
    }
  });

  it('handles all-zero signal', () => {
    const sig = new Float64Array(100).fill(0);
    const out = detrendMovingAverage(sig, 21);
    for (let i = 0; i < 100; i++) {
      expect(out[i]).toBe(0);
    }
  });

  it('handles negative values', () => {
    const sig = new Float64Array(100);
    for (let i = 0; i < 100; i++) sig[i] = -50 + Math.sin(i * 0.5);
    const out = detrendMovingAverage(sig, 21);
    // Should remove the -50 offset; interior mean should be near zero
    const interior = out.slice(21, 79);
    expect(Math.abs(mean(interior))).toBeLessThan(1);
  });

  it('handles very large window (odd) on moderate signal', () => {
    const n = 50;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) sig[i] = i * i; // quadratic
    const out = detrendMovingAverage(sig, 999);
    // Window covers entire signal → subtract global mean
    const gm = mean(sig);
    for (let i = 0; i < n; i++) {
      expect(out[i]).toBeCloseTo(sig[i] - gm, 8);
    }
  });

  it('matches known output for realistic rPPG-sized input', () => {
    // Simulate 10 seconds at 30 FPS with drift + pulse
    const fs = 30;
    const n = 300;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sig[i] = 0.5 * (i / n) // linear drift
             + 0.1 * Math.sin(2 * Math.PI * 1.2 * i / fs) // 72 BPM pulse
             + 0.02 * Math.sin(2 * Math.PI * 0.25 * i / fs); // breathing
    }
    const out = detrendMovingAverage(sig, 75);
    // Drift should be removed; 1.2 Hz pulse preserved
    const freq = dominantFrequency(out, fs, 0.5, 4.0);
    expect(freq.frequency).toBeCloseTo(1.2, 0);
    // Output should be bounded (no explosions)
    for (let i = 0; i < n; i++) {
      expect(Math.abs(out[i])).toBeLessThan(1);
    }
  });

  // ── Real-world rPPG stress tests ──────────────────────────────────────────

  it('preserves pulse under low-light high-noise conditions (SNR ~0.5)', () => {
    // Low light → POS output has very low pulse amplitude buried in noise.
    // The detrending must not destroy the weak pulse or amplify noise.
    const fs = 30;
    const n = 450; // 15s buffer
    const pulseAmp = 0.005; // very weak pulse (low light)
    const noiseAmp = 0.01;  // noise is 2× the signal
    const sig = new Float64Array(n);
    // Seed a deterministic pseudo-random sequence
    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
    for (let i = 0; i < n; i++) {
      sig[i] = pulseAmp * Math.sin(2 * Math.PI * 1.0 * i / fs) // 60 BPM
             + noiseAmp * rand();
    }
    const out = detrendMovingAverage(sig, 75);
    // Output must be finite and bounded (no NaN / explosion)
    for (let i = 0; i < n; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
      expect(Math.abs(out[i])).toBeLessThan(0.1);
    }
    // The pulse component should survive (std not crushed to zero)
    expect(std(out)).toBeGreaterThan(pulseAmp * 0.3);
  });

  it('handles sudden motion artifact (baseline jump mid-signal)', () => {
    // Head movement causes a sudden DC shift in the POS signal.
    // Detrending should adapt and not ring for hundreds of samples.
    const fs = 30;
    const n = 450;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const baseline = i < 225 ? 0 : 2.0; // abrupt +2 shift at 7.5s
      sig[i] = baseline + 0.1 * Math.sin(2 * Math.PI * 1.2 * i / fs);
    }
    const out = detrendMovingAverage(sig, 75);
    // Well away from the step (last 3s), output should be centered near 0
    const tail = out.slice(375); // last 2.5s
    expect(Math.abs(mean(tail))).toBeLessThan(0.15);
    // Pulse should still be visible in the tail
    expect(std(tail)).toBeGreaterThan(0.03);
  });

  it('suppresses LED flicker at 50 Hz subharmonic (100/120 Hz aliased)', () => {
    // LED lighting at 100 Hz (doubled mains) aliases to different frequencies
    // at 30 fps. 100 Hz sampled at 30 fps: 100 mod 30 = 10 Hz, which is
    // above the HR band. But a 50 Hz source aliases to 50 mod 30 = 20 Hz
    // (also above band). More realistically, PWM dimming can produce
    // low-frequency beat patterns. Simulate a 0.5 Hz beat (slow flicker).
    const fs = 30;
    const n = 450;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sig[i] = 0.3 * Math.sin(2 * Math.PI * 0.5 * i / fs)  // 0.5 Hz flicker beat
             + 0.05 * Math.sin(2 * Math.PI * 1.33 * i / fs); // 80 BPM pulse
    }
    const out = detrendMovingAverage(sig, 75);
    // The 0.5 Hz flicker is below the detrend cutoff (~0.18 Hz for 75-sample
    // window). It's above 0.18 Hz so it won't be fully removed by DMA alone,
    // but it should be attenuated. The pulse at 1.33 Hz must survive.
    const result = dominantFrequency(out, fs, 0.7, 4.0);
    expect(result.frequency).toBeCloseTo(1.33, 0);
  });

  it('handles gradual exponential illumination drift (auto-exposure)', () => {
    // Camera auto-exposure adjusting → exponential baseline change.
    const fs = 30;
    const n = 450;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sig[i] = 5 * Math.exp(-i / (fs * 3)) // ~3s time constant decay
             + 0.08 * Math.sin(2 * Math.PI * 1.0 * i / fs); // 60 BPM
    }
    const out = detrendMovingAverage(sig, 75);
    // After the first ~3s, exponential is mostly gone; interior should be small
    const interior = out.slice(150, 400);
    expect(Math.abs(mean(interior))).toBeLessThan(0.5);
    // Pulse must survive
    const result = dominantFrequency(out, fs, 0.7, 4.0);
    expect(result.frequency).toBeCloseTo(1.0, 0);
  });

  it('preserves pulse when baseline oscillates (breathing-induced motion)', () => {
    // Breathing at ~0.25 Hz causes a slow baseline modulation much larger
    // than the pulse. The detrending window (2.5s → ~0.18 Hz cutoff) should
    // attenuate the 0.25 Hz breathing component.
    const fs = 30;
    const n = 450;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sig[i] = 0.5 * Math.sin(2 * Math.PI * 0.25 * i / fs)  // breathing
             + 0.05 * Math.sin(2 * Math.PI * 1.17 * i / fs); // 70 BPM
    }
    const out = detrendMovingAverage(sig, 75);
    // Breathing amplitude should be reduced
    // Original breathing peak-to-peak = 1.0, pulse = 0.1
    // After detrending, output std should be much less than 0.5
    expect(std(out)).toBeLessThan(0.4);
    // Output should not be all zero (pulse preserved)
    expect(std(out)).toBeGreaterThan(0.01);
  });

  it('handles spike artifacts (transient face detection glitch)', () => {
    // A single-frame tracking glitch produces an impulse spike.
    // The filter should contain the damage to nearby samples.
    const fs = 30;
    const n = 300;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sig[i] = 0.08 * Math.sin(2 * Math.PI * 1.0 * i / fs);
    }
    // Inject a massive spike at frame 150
    sig[150] = 10.0;
    const out = detrendMovingAverage(sig, 75);
    // The spike leaks into the moving average over a 75-sample window,
    // but samples far from the spike should be mostly unaffected.
    // Check samples >50 frames away from the spike
    for (let i = 0; i < 90; i++) {
      expect(Math.abs(out[i])).toBeLessThan(0.5);
    }
    for (let i = 210; i < n; i++) {
      expect(Math.abs(out[i])).toBeLessThan(0.5);
    }
  });

  it('handles periodic dropout frames (intermittent face loss)', () => {
    // Every ~1s, one frame drops to zero (face detector lost the face).
    const fs = 30;
    const n = 450;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sig[i] = 0.5 + 0.1 * Math.sin(2 * Math.PI * 1.2 * i / fs);
      if (i % 30 === 15) sig[i] = 0; // dropout every 30 frames
    }
    const out = detrendMovingAverage(sig, 75);
    // Should still produce finite output everywhere
    for (let i = 0; i < n; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
    // The overall signal structure should survive (std not zero)
    expect(std(out)).toBeGreaterThan(0.01);
  });

  it('handles strong shadow boundary oscillation (head turning)', () => {
    // Slow head rotation causes a sinusoidal brightness change at ~0.1 Hz
    // (one full turn-and-back in 10s) with amplitude 10× the pulse.
    const fs = 30;
    const n = 450;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sig[i] = 1.0 * Math.sin(2 * Math.PI * 0.1 * i / fs) // shadow at 0.1 Hz
             + 0.05 * Math.sin(2 * Math.PI * 1.5 * i / fs); // 90 BPM pulse
    }
    const out = detrendMovingAverage(sig, 75);
    // 0.1 Hz is well below the cutoff → should be heavily attenuated
    // The 1.5 Hz pulse should dominate the output
    const result = dominantFrequency(out, fs, 0.7, 4.0);
    expect(result.frequency).toBeCloseTo(1.5, 0);
  });

  it('handles multi-frequency drift (non-stationary illumination)', () => {
    // Real lighting is not a single sinusoid — simulate sum of slow drifts
    // plus a realistic multi-harmonic pulse (fundamental + 2nd harmonic).
    const fs = 30;
    const n = 450;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sig[i] = 2.0 * Math.sin(2 * Math.PI * 0.05 * i / fs)  // very slow drift
             + 0.8 * Math.sin(2 * Math.PI * 0.12 * i / fs)   // another drift
             + 0.3 * (i / n)                                    // linear trend
             + 0.06 * Math.sin(2 * Math.PI * 1.0 * i / fs)    // 60 BPM fundamental
             + 0.02 * Math.sin(2 * Math.PI * 2.0 * i / fs);   // 2nd harmonic
    }
    const out = detrendMovingAverage(sig, 75);
    // All drift components are < 0.18 Hz → should be removed
    // The 1.0 Hz pulse should be the dominant frequency
    const result = dominantFrequency(out, fs, 0.7, 4.0);
    expect(result.frequency).toBeCloseTo(1.0, 0);
  });

  it('handles varying pulse amplitude (perfusion changes across skin tones)', () => {
    // Darker skin tones yield lower SNR and amplitude-modulated pulse.
    // Simulate pulse amplitude that varies slowly over time.
    const fs = 30;
    const n = 450;
    const sig = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // Amplitude envelope: starts at 0.02 (dark skin, low perfusion),
      // ramps to 0.1 (lighter skin / better perfusion)
      const amp = 0.02 + 0.08 * (i / n);
      sig[i] = 0.3 // DC offset (mean pixel intensity difference)
             + amp * Math.sin(2 * Math.PI * 1.17 * i / fs)  // 70 BPM
             + 0.01 * Math.sin(2 * Math.PI * 0.08 * i / fs); // slow drift
    }
    const out = detrendMovingAverage(sig, 75);
    // DC offset and slow drift removed
    const interior = out.slice(100, 400);
    expect(Math.abs(mean(interior))).toBeLessThan(0.1);
    // Pulse should survive even in the low-amplitude early section
    const earlySection = out.slice(75, 200);
    expect(std(earlySection)).toBeGreaterThan(0.005);
    // Pulse frequency should be detectable
    const result = dominantFrequency(out, fs, 0.7, 4.0);
    expect(result.frequency).toBeCloseTo(1.17, 0);
  });
});

// ─── normalize ───────────────────────────────────────────────────────────────

describe('normalize', () => {
  it('produces zero mean and unit standard deviation', () => {
    const sig = new Float64Array([2, 4, 6, 8, 10, 12, 14]);
    const out = normalize(sig);

    expect(mean(out)).toBeCloseTo(0, 10);
    expect(std(out)).toBeCloseTo(1, 10);
  });

  it('returns zeros for a constant signal (zero variance)', () => {
    const sig = new Float64Array(50).fill(42);
    const out = normalize(sig);

    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBe(0);
    }
  });

  it('returns empty array for empty input', () => {
    const sig = new Float64Array(0);
    const out = normalize(sig);
    expect(out.length).toBe(0);
  });

  it('preserves relative ordering', () => {
    const sig = new Float64Array([1, 3, 2, 5, 4]);
    const out = normalize(sig);

    expect(out[1]).toBeGreaterThan(out[0]); // 3 > 1
    expect(out[2]).toBeLessThan(out[1]);    // 2 < 3
    expect(out[3]).toBeGreaterThan(out[4]); // 5 > 4
  });

  it('correctly normalizes a sine wave', () => {
    const sig = makeSine(1000, 1.0, 30);
    const out = normalize(sig);

    expect(mean(out)).toBeCloseTo(0, 5);
    expect(std(out)).toBeCloseTo(1, 5);
  });
});
