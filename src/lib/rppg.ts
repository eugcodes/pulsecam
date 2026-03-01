/**
 * Core rPPG algorithm: POS (Plane-Orthogonal-to-Skin) method.
 *
 * Reference: Wang, W., den Brinker, A. C., Stuijk, S., & de Haan, G. (2017).
 * "Algorithmic Principles of Remote PPG."
 * IEEE Transactions on Biomedical Engineering, 64(7), 1479-1491.
 */

import {
  detrend,
  normalize,
  butterworthBandpass,
  filterSignal,
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
  const H = new Float64Array(n);

  for (let t = 0; t < n; t++) {
    const start = Math.max(0, t - windowLen + 1);
    const end = t + 1;
    const len = end - start;

    // Compute temporal mean of RGB in window
    let meanR = 0, meanG = 0, meanB = 0;
    for (let i = start; i < end; i++) {
      meanR += rgbBuffer[i].r;
      meanG += rgbBuffer[i].g;
      meanB += rgbBuffer[i].b;
    }
    meanR /= len;
    meanG /= len;
    meanB /= len;

    // Avoid division by zero
    if (meanR < 1e-6 || meanG < 1e-6 || meanB < 1e-6) continue;

    // Normalize Cn = [R/meanR, G/meanG, B/meanB] for current sample
    const cn_r = rgbBuffer[t].r / meanR;
    const cn_g = rgbBuffer[t].g / meanG;
    const cn_b = rgbBuffer[t].b / meanB;

    // POS projection: S1 = Cn_g - Cn_b, S2 = Cn_g + Cn_b - 2*Cn_r
    const s1 = cn_g - cn_b;
    const s2 = cn_g + cn_b - 2 * cn_r;

    // Combine: H(t) = S1 + alpha * S2, where alpha = std(S1)/std(S2)
    // For per-sample, approximate with the window stats
    H[t] = s1; // Initial estimate, refined below
  }

  // Compute in overlapping windows for alpha
  const result = new Float64Array(n);
  const wLen = Math.max(windowLen, 10);

  for (let start = 0; start < n; start += Math.floor(wLen / 2)) {
    const end = Math.min(start + wLen, n);
    const len = end - start;

    // Compute S1, S2 arrays for this window
    const S1 = new Float64Array(len);
    const S2 = new Float64Array(len);

    for (let i = 0; i < len; i++) {
      const idx = start + i;
      // Temporal mean for normalization
      const wStart = Math.max(0, idx - windowLen + 1);
      const wEnd = idx + 1;
      const wLen2 = wEnd - wStart;
      let mR = 0, mG = 0, mB = 0;
      for (let j = wStart; j < wEnd; j++) {
        mR += rgbBuffer[j].r;
        mG += rgbBuffer[j].g;
        mB += rgbBuffer[j].b;
      }
      mR /= wLen2;
      mG /= wLen2;
      mB /= wLen2;

      if (mR < 1e-6 || mG < 1e-6 || mB < 1e-6) continue;

      const cr = rgbBuffer[idx].r / mR;
      const cg = rgbBuffer[idx].g / mG;
      const cb = rgbBuffer[idx].b / mB;

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

    // Combine with overlap-add
    for (let i = 0; i < len; i++) {
      result[start + i] += S1[i] + alpha * S2[i];
    }
  }

  return result;
}

/**
 * Full rPPG processing pipeline:
 * 1. POS algorithm
 * 2. Detrending
 * 3. Bandpass filtering
 * 4. FFT-based BPM estimation
 */
export function processRPPG(
  rgbBuffer: RGBSample[],
  sampleRate: number,
): PulseResult | null {
  if (rgbBuffer.length < sampleRate * 3) return null;

  // 1. POS algorithm
  const rawPulse = posAlgorithm(rgbBuffer, sampleRate);
  if (rawPulse.length === 0) return null;

  // 2. Detrend (remove slow drift)
  const detrended = detrend(rawPulse);

  // 3. Bandpass filter (0.7–4.0 Hz = 42–240 BPM)
  const coeffs = butterworthBandpass(MIN_HR_HZ, MAX_HR_HZ, sampleRate);
  const filtered = filterSignal(detrended, coeffs);

  // 4. Normalize for display
  const waveform = normalize(filtered);

  // 5. FFT-based frequency estimation
  const { frequency, magnitude, spectrum } = dominantFrequency(
    filtered,
    sampleRate,
    MIN_HR_HZ,
    MAX_HR_HZ,
  );

  const bpm = frequency * 60;

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

  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence,
    waveform,
    rawSignal: filtered,
    spectrum,
    sampleRate,
  };
}
