/**
 * Core rPPG algorithms: POS (Plane-Orthogonal-to-Skin) and CHROM (Chrominance).
 *
 * POS reference: Wang, W., den Brinker, A. C., Stuijk, S., & de Haan, G. (2017).
 * "Algorithmic Principles of Remote PPG."
 * IEEE Transactions on Biomedical Engineering, 64(7), 1479-1491.
 *
 * CHROM reference: de Haan, G., & Jeanne, V. (2013).
 * "Robust Pulse Rate From Chrominance-Based rPPG."
 * IEEE Transactions on Biomedical Engineering, 60(10), 2878-2886.
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

/** Persistent state for temporal BPM smoothing and algorithm fallback. */
export interface BpmSmoothingState {
  prevBpm: number | null;
  /** Number of consecutive cycles where POS confidence was below the fallback threshold. */
  posLowConfidenceCount: number;
}

export function createBpmSmoothingState(): BpmSmoothingState {
  return { prevBpm: null, posLowConfidenceCount: 0 };
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
 * CHROM (Chrominance-based) rPPG algorithm.
 * Uses chrominance projections to separate pulse from specular reflection.
 * Same windowing structure as POS for consistency.
 */
export function chromAlgorithm(
  rgbBuffer: RGBSample[],
  sampleRate: number,
): Float64Array {
  const n = rgbBuffer.length;
  if (n < 3) return new Float64Array(0);

  const windowLen = Math.round(POS_WINDOW_SEC * sampleRate);
  const result = new Float64Array(n);
  const wLen = Math.max(windowLen, 10);

  for (let start = 0; start < n; start += Math.floor(wLen / 2)) {
    const end = Math.min(start + wLen, n);
    const len = end - start;

    // Per-window mean for temporal normalization
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

    // Chrominance projections (de Haan & Jeanne 2013)
    const Xs = new Float64Array(len);
    const Ys = new Float64Array(len);

    for (let i = 0; i < len; i++) {
      const rn = rgbBuffer[start + i].r / mR;
      const gn = rgbBuffer[start + i].g / mG;
      const bn = rgbBuffer[start + i].b / mB;

      Xs[i] = 3 * rn - 2 * gn;
      Ys[i] = 1.5 * rn + gn - 1.5 * bn;
    }

    // Standard deviations for adaptive weighting
    let meanXs = 0, meanYs = 0;
    for (let i = 0; i < len; i++) {
      meanXs += Xs[i];
      meanYs += Ys[i];
    }
    meanXs /= len;
    meanYs /= len;

    let varXs = 0, varYs = 0;
    for (let i = 0; i < len; i++) {
      varXs += (Xs[i] - meanXs) ** 2;
      varYs += (Ys[i] - meanYs) ** 2;
    }
    const stdXs = Math.sqrt(varXs / len);
    const stdYs = Math.sqrt(varYs / len);

    const alpha = stdYs > 1e-10 ? stdXs / stdYs : 1;

    // Pulse signal: Xs - alpha * Ys, mean-subtracted
    const h = new Float64Array(len);
    let hMean = 0;
    for (let i = 0; i < len; i++) {
      h[i] = Xs[i] - alpha * Ys[i];
      hMean += h[i];
    }
    hMean /= len;

    for (let i = 0; i < len; i++) {
      result[start + i] += h[i] - hMean;
    }
  }

  return result;
}

// Threshold below which POS is considered failing
const POS_FALLBACK_CONFIDENCE = 0.15;
// Number of consecutive low-confidence POS cycles before switching to CHROM
const POS_FALLBACK_CYCLES = 3;

/** Run detrend → bandpass → normalize → FFT → confidence on an extracted pulse signal. */
function runPipeline(
  rawPulse: Float64Array,
  sampleRate: number,
): {
  filtered: Float64Array;
  waveform: Float64Array;
  frequency: number;
  magnitude: number;
  spectrum: Float64Array;
  confidence: number;
} {
  // Detrend (remove slow drift via moving-average subtraction)
  const detrendWindow = Math.round(sampleRate * 2.5);
  const detrended = detrendMovingAverage(rawPulse, detrendWindow);

  // Bandpass filter (0.7–4.0 Hz = 42–240 BPM), zero-phase (filtfilt)
  const coeffs = butterworthBandpass(MIN_HR_HZ, MAX_HR_HZ, sampleRate);
  const filtered = filtfiltSignal(detrended, coeffs);

  // Normalize for display
  const waveform = normalize(filtered);

  // FFT-based frequency estimation (Hann-windowed)
  const { frequency, magnitude, spectrum } = dominantFrequency(
    filtered,
    sampleRate,
    MIN_HR_HZ,
    MAX_HR_HZ,
  );

  // Confidence: ratio of peak to mean spectral power in band
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

  return { filtered, waveform, frequency, magnitude, spectrum, confidence };
}

/**
 * Full rPPG processing pipeline:
 * 1. POS algorithm (primary) with CHROM fallback
 * 2. Moving-average detrending
 * 3. Zero-phase bandpass filtering
 * 4. Hann-windowed FFT with parabolic interpolation
 * 5. Temporal BPM smoothing (EMA)
 *
 * CHROM is used only when POS confidence stays below 0.15 for 3+ consecutive
 * processing cycles. POS is restored as soon as its confidence recovers.
 */
export function processRPPG(
  rgbBuffer: RGBSample[],
  sampleRate: number,
  smoothingState?: BpmSmoothingState,
): PulseResult | null {
  if (rgbBuffer.length < sampleRate * 3) return null;

  // 1. Extract pulse signals from both algorithms
  const posRaw = posAlgorithm(rgbBuffer, sampleRate);
  if (posRaw.length === 0) return null;

  const chromRaw = chromAlgorithm(rgbBuffer, sampleRate);

  // 2. Run the DSP pipeline on both
  const posResult = runPipeline(posRaw, sampleRate);
  const chromResult = chromRaw.length > 0 ? runPipeline(chromRaw, sampleRate) : null;

  // 3. Select algorithm: POS is primary, CHROM is fallback
  let selected = posResult;
  if (smoothingState) {
    if (posResult.confidence < POS_FALLBACK_CONFIDENCE) {
      smoothingState.posLowConfidenceCount++;
    } else {
      smoothingState.posLowConfidenceCount = 0;
    }

    // Switch to CHROM only after sustained POS failure
    if (
      smoothingState.posLowConfidenceCount >= POS_FALLBACK_CYCLES &&
      chromResult &&
      chromResult.confidence > posResult.confidence
    ) {
      selected = chromResult;
    }
  }

  let bpm = selected.frequency * 60;
  const confidence = selected.confidence;

  // 4. Temporal BPM smoothing (EMA, alpha=0.25 → ~4-frame smoothing)
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
    waveform: selected.waveform,
    rawSignal: selected.filtered,
    spectrum: selected.spectrum,
    sampleRate,
  };
}
