/**
 * Web Worker for rPPG signal processing.
 * Keeps heavy computation off the UI thread.
 */

import { processRPPG, createBpmSmoothingState } from '../lib/rppg';
import type { RGBSample, PulseResult } from '../lib/rppg';
import { assessSignalQuality, estimateMotion } from '../lib/signalQuality';
import type { SignalQualityResult } from '../lib/signalQuality';

// Buffer of RGB samples
let rgbBuffer: RGBSample[] = [];
let roiHistory: Array<{ x: number; y: number }> = [];
let faceDetected = false;
let sampleRate = 30;

// Smoothing for BPM
const bpmHistory: number[] = [];
const BPM_SMOOTH_WINDOW = 5;
const bpmSmoothingState = createBpmSmoothingState();

export interface WorkerMessage {
  type: 'addSample' | 'setFaceDetected' | 'setSampleRate' | 'reset' | 'process';
  sample?: { r: number; g: number; b: number; timestamp: number };
  roiCenter?: { x: number; y: number };
  faceDetected?: boolean;
  sampleRate?: number;
}

export interface WorkerResult {
  type: 'result';
  bpm: number | null;
  smoothedBpm: number | null;
  confidence: number;
  quality: SignalQualityResult;
  waveform: number[];
  bufferLength: number;
  sampleRate: number;
}

// Max buffer: ~15 seconds of data
const MAX_BUFFER_SECONDS = 15;

function getSmoothedBpm(bpm: number): number {
  bpmHistory.push(bpm);
  if (bpmHistory.length > BPM_SMOOTH_WINDOW) {
    bpmHistory.shift();
  }

  // Median filter for robustness
  const sorted = [...bpmHistory].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'addSample': {
      if (msg.sample) {
        rgbBuffer.push(msg.sample);
        // Trim buffer
        const maxLen = Math.round(MAX_BUFFER_SECONDS * sampleRate);
        if (rgbBuffer.length > maxLen) {
          rgbBuffer = rgbBuffer.slice(-maxLen);
        }
      }
      if (msg.roiCenter) {
        roiHistory.push(msg.roiCenter);
        if (roiHistory.length > 60) {
          roiHistory = roiHistory.slice(-60);
        }
      }
      break;
    }

    case 'setFaceDetected': {
      faceDetected = msg.faceDetected ?? false;
      break;
    }

    case 'setSampleRate': {
      sampleRate = msg.sampleRate ?? 30;
      break;
    }

    case 'reset': {
      rgbBuffer = [];
      roiHistory = [];
      bpmHistory.length = 0;
      bpmSmoothingState.prevBpm = null;
      break;
    }

    case 'process': {
      const motionLevel = estimateMotion(roiHistory);
      let result: PulseResult | null = null;

      if (faceDetected && rgbBuffer.length > sampleRate * 3) {
        result = processRPPG(rgbBuffer, sampleRate, bpmSmoothingState);
      }

      const confidence = result?.confidence ?? 0;
      const quality = assessSignalQuality(confidence, faceDetected, motionLevel);

      let bpm: number | null = null;
      let smoothedBpm: number | null = null;

      if (result && result.bpm >= 45 && result.bpm <= 180 && confidence > 0.1) {
        bpm = result.bpm;
        smoothedBpm = Math.round(getSmoothedBpm(bpm));
      }

      const waveform = result?.waveform
        ? Array.from(result.waveform.slice(-Math.round(sampleRate * 10)))
        : [];

      const response: WorkerResult = {
        type: 'result',
        bpm,
        smoothedBpm,
        confidence,
        quality,
        waveform,
        bufferLength: rgbBuffer.length,
        sampleRate,
      };

      self.postMessage(response);
      break;
    }
  }
};
