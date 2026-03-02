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
