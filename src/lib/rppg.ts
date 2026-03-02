/**
 * Core rPPG algorithm: POS (Plane-Orthogonal-to-Skin) method.
 *
 * Reference: Wang, W., den Brinker, A. C., Stuijk, S., & de Haan, G. (2017).
 * "Algorithmic Principles of Remote PPG."
 * IEEE Transactions on Biomedical Engineering, 64(7), 1479-1491.
 */

import {
  detrendMovingAverage,
  normalize,
  butterworthBandpass,
  filtfiltSignal,
  dominantFrequency,
} from './filters';

export interface RGBSample {
  r: number;
  g: number;
  b: number;
  timestamp: number;
}

export interface PulseResult {
  bpm: number;
  confidence: number;
  waveform: Float64Array;
  rawSignal: Float64Array;
  spectrum: Float64Array;
  sampleRate: number;
}

/** Persistent state for temporal BPM smoothing across frames. */
export interface BpmSmoothingState {
  prevBpm: number | null;
}

export function createBpmSmoothingState(): BpmSmoothingState {
  return { prevBpm: null };
}

const MIN_HR_HZ = 0.7; // 42 BPM
const MAX_HR_HZ = 4.0; // 240 BPM
const POS_WINDOW_SEC = 1.6; // POS temporal window

/**
 * POS (Plane-Orthogonal-to-Skin) rPPG algorithm.
 * Extracts pulse signal from a buffer of RGB samples.
 */
export function posAlgorithm(
  rgbBuffer: RGBSample[],
  sampleRate: number,
): Float64Array {
  const n = rgbBuffer.length;
  if (n < 3) return new Float64Array(0);

  const windowLen = Math.round(POS_WINDOW_SEC * sampleRate);

  // Overlap-add in sliding windows (Wang et al. 2017)
  const result = new Float64Array(n);
  const wLen = Math.max(windowLen, 10);

  for (let start = 0; start < n; start += Math.floor(wLen / 2)) {
    const end = Math.min(start + wLen, n);
    const len = end - start;

    // T5: Single per-window mean for temporal normalization
    // (matches Wang et al. 2017 pseudocode and pyVHR/rPPG-Toolbox implementations)
    let mR = 0, mG = 0, mB = 0;
    for (let i = 0; i < len; i++) {
      mR += rgbBuffer[start + i].r;
      mG += rgbBuffer[start + i].g;
      mB += rgbBuffer[start + i].b;
    }
    mR /= len;
    mG /= len;
    mB /= len;

    if (mR < 1e-6 || mG < 1e-6 || mB < 1e-6) continue;

    // Normalize all samples in window by the single window mean, then project
    const S1 = new Float64Array(len);
    const S2 = new Float64Array(len);

    for (let i = 0; i < len; i++) {
      const cr = rgbBuffer[start + i].r / mR;
      const cg = rgbBuffer[start + i].g / mG;
      const cb = rgbBuffer[start + i].b / mB;

      S1[i] = cg - cb;
      S2[i] = cg + cb - 2 * cr;
    }

    // Standard deviations
    let meanS1 = 0, meanS2 = 0;
    for (let i = 0; i < len; i++) {
      meanS1 += S1[i];
      meanS2 += S2[i];
    }
    meanS1 /= len;
    meanS2 /= len;

    let varS1 = 0, varS2 = 0;
    for (let i = 0; i < len; i++) {
      varS1 += (S1[i] - meanS1) ** 2;
      varS2 += (S2[i] - meanS2) ** 2;
    }
    const stdS1 = Math.sqrt(varS1 / len);
    const stdS2 = Math.sqrt(varS2 / len);

    const alpha = stdS2 > 1e-10 ? stdS1 / stdS2 : 1;

    // T6: Mean-subtract h before overlap-add (per iPhys / McDuff)
    // Prevents DC accumulation across overlapping windows
    const h = new Float64Array(len);
    let hMean = 0;
    for (let i = 0; i < len; i++) {
      h[i] = S1[i] + alpha * S2[i];
      hMean += h[i];
    }
    hMean /= len;

    for (let i = 0; i < len; i++) {
      result[start + i] += h[i] - hMean;
    }
  }

  return result;
}

/**
 * Full rPPG processing pipeline:
 * 1. POS algorithm
 * 2. Moving-average detrending
 * 3. Zero-phase bandpass filtering
 * 4. Hann-windowed FFT with parabolic interpolation
 * 5. Temporal BPM smoothing (EMA)
 */
export function processRPPG(
  rgbBuffer: RGBSample[],
  sampleRate: number,
  smoothingState?: BpmSmoothingState,
): PulseResult | null {
  if (rgbBuffer.length < sampleRate * 3) return null;

  // 1. POS algorithm
  const rawPulse = posAlgorithm(rgbBuffer, sampleRate);
  if (rawPulse.length === 0) return null;

  // 2. Detrend (remove slow drift via moving-average subtraction)
  // Window of 2.5s → high-pass cutoff ~0.18 Hz, well below HR band (0.7+ Hz)
  const detrendWindow = Math.round(sampleRate * 2.5);
  const detrended = detrendMovingAverage(rawPulse, detrendWindow);

  // 3. Bandpass filter (0.7–4.0 Hz = 42–240 BPM), zero-phase (filtfilt)
  const coeffs = butterworthBandpass(MIN_HR_HZ, MAX_HR_HZ, sampleRate);
  const filtered = filtfiltSignal(detrended, coeffs);

  // 4. Normalize for display
  const waveform = normalize(filtered);

  // 5. FFT-based frequency estimation (Hann-windowed)
  const { frequency, magnitude, spectrum } = dominantFrequency(
    filtered,
    sampleRate,
    MIN_HR_HZ,
    MAX_HR_HZ,
  );

  let bpm = frequency * 60;

  // 6. Confidence: ratio of peak to mean spectral power in band
  const N = spectrum.length;
  const minBin = Math.max(1, Math.floor((MIN_HR_HZ * N * 2) / sampleRate));
  const maxBin = Math.min(N - 1, Math.ceil((MAX_HR_HZ * N * 2) / sampleRate));
  let totalPower = 0;
  let count = 0;
  for (let i = minBin; i <= maxBin; i++) {
    totalPower += spectrum[i];
    count++;
  }
  const meanPower = count > 0 ? totalPower / count : 1;
  const snr = meanPower > 0 ? magnitude / meanPower : 0;
  const confidence = Math.min(1, Math.max(0, (snr - 1.5) / 5));

  // 7. Temporal BPM smoothing (EMA, alpha=0.25 → ~4-frame smoothing)
  if (smoothingState) {
    if (smoothingState.prevBpm !== null && confidence > 0.1) {
      bpm = 0.25 * bpm + 0.75 * smoothingState.prevBpm;
    }
    if (confidence > 0.1) {
      smoothingState.prevBpm = bpm;
    }
  }

  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence,
    waveform,
    rawSignal: filtered,
    spectrum,
    sampleRate,
  };
}
