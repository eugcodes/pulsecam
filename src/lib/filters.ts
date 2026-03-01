/**
 * DSP utilities: FFT, Butterworth bandpass filter, detrending.
 */

// ─── FFT (Cooley-Tukey radix-2) ──────────────────────────────────────────────

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Real-valued FFT. Returns magnitude spectrum of length N/2. */
export function fft(signal: Float64Array): Float64Array {
  const N = nextPow2(signal.length);
  // Zero-pad
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  re.set(signal);

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // FFT butterfly
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < N; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < half; j++) {
        const tRe = curRe * re[i + j + half] - curIm * im[i + j + half];
        const tIm = curRe * im[i + j + half] + curIm * re[i + j + half];
        re[i + j + half] = re[i + j] - tRe;
        im[i + j + half] = im[i + j] - tIm;
        re[i + j] += tRe;
        im[i + j] += tIm;
        const newCurRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newCurRe;
      }
    }
  }

  // Magnitude spectrum (first half)
  const mag = new Float64Array(N >> 1);
  for (let i = 0; i < mag.length; i++) {
    mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  return mag;
}

/** Find dominant frequency in a signal using FFT. Returns frequency in Hz. */
export function dominantFrequency(
  signal: Float64Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
): { frequency: number; magnitude: number; spectrum: Float64Array } {
  const N = nextPow2(signal.length);
  const mag = fft(signal);

  const minBin = Math.max(1, Math.floor((minHz * N) / sampleRate));
  const maxBin = Math.min(mag.length - 1, Math.ceil((maxHz * N) / sampleRate));

  let peakBin = minBin;
  let peakMag = 0;
  for (let i = minBin; i <= maxBin; i++) {
    if (mag[i] > peakMag) {
      peakMag = mag[i];
      peakBin = i;
    }
  }

  // Parabolic interpolation for sub-bin accuracy
  let freq: number;
  if (peakBin > 0 && peakBin < mag.length - 1) {
    const alpha = mag[peakBin - 1];
    const beta = mag[peakBin];
    const gamma = mag[peakBin + 1];
    const denom = alpha - 2 * beta + gamma;
    const p = denom !== 0 ? 0.5 * (alpha - gamma) / denom : 0;
    freq = ((peakBin + p) * sampleRate) / N;
  } else {
    freq = (peakBin * sampleRate) / N;
  }

  return { frequency: freq, magnitude: peakMag, spectrum: mag };
}

// ─── Butterworth Bandpass Filter ─────────────────────────────────────────────

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** 2nd-order Butterworth bandpass filter coefficients. */
export function butterworthBandpass(
  lowHz: number,
  highHz: number,
  sampleRate: number,
): BiquadCoeffs {
  const w0 = (2 * Math.PI * Math.sqrt(lowHz * highHz)) / sampleRate;
  const bw = (2 * Math.PI * (highHz - lowHz)) / sampleRate;

  const sinW0 = Math.sin(w0);
  const cosW0 = Math.cos(w0);
  const alpha = sinW0 * Math.sinh((Math.log(2) / 2) * (bw / sinW0));

  const a0 = 1 + alpha;

  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

export interface FilterState {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export function createFilterState(): FilterState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

/** Apply biquad filter to a single sample. Mutates state. */
export function biquadFilter(
  sample: number,
  coeffs: BiquadCoeffs,
  state: FilterState,
): number {
  const y =
    coeffs.b0 * sample +
    coeffs.b1 * state.x1 +
    coeffs.b2 * state.x2 -
    coeffs.a1 * state.y1 -
    coeffs.a2 * state.y2;

  state.x2 = state.x1;
  state.x1 = sample;
  state.y2 = state.y1;
  state.y1 = y;

  return y;
}

/** Apply biquad filter to entire signal array. */
export function filterSignal(
  signal: Float64Array,
  coeffs: BiquadCoeffs,
): Float64Array {
  const out = new Float64Array(signal.length);
  const state = createFilterState();
  for (let i = 0; i < signal.length; i++) {
    out[i] = biquadFilter(signal[i], coeffs, state);
  }
  return out;
}

// ─── Detrending ──────────────────────────────────────────────────────────────

/** Remove linear trend from a signal using least-squares. */
export function detrend(signal: Float64Array): Float64Array {
  const n = signal.length;
  if (n < 2) return new Float64Array(signal);

  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += signal[i];
    sxx += i * i;
    sxy += i * signal[i];
  }
  const denom = n * sxx - sx * sx;
  const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const intercept = (sy - slope * sx) / n;

  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = signal[i] - (slope * i + intercept);
  }
  return out;
}

/** Subtract a moving average to remove slow drift. */
export function detrendMovingAverage(
  signal: Float64Array,
  windowSize: number,
): Float64Array {
  const n = signal.length;
  const out = new Float64Array(n);
  const half = Math.floor(windowSize / 2);

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(n - 1, i + half);
    let sum = 0;
    for (let j = start; j <= end; j++) {
      sum += signal[j];
    }
    out[i] = signal[i] - sum / (end - start + 1);
  }
  return out;
}

// ─── Normalization ───────────────────────────────────────────────────────────

/** Normalize signal to zero mean, unit variance. */
export function normalize(signal: Float64Array): Float64Array {
  const n = signal.length;
  if (n === 0) return signal;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;

  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = signal[i] - mean;
    variance += d * d;
  }
  variance /= n;
  const std = Math.sqrt(variance);

  const out = new Float64Array(n);
  if (std > 1e-10) {
    for (let i = 0; i < n; i++) {
      out[i] = (signal[i] - mean) / std;
    }
  }
  return out;
}
