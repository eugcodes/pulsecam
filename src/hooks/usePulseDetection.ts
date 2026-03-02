import { useState, useEffect, useRef, useCallback } from 'react';
import { initFaceDetection, detectFace, extractROIColors, destroyFaceDetection } from '../lib/faceDetection';
import type { FaceROI } from '../lib/faceDetection';
import type { WorkerMessage, WorkerResult } from '../workers/signalProcessor.worker';
import type { SignalQualityResult } from '../lib/signalQuality';

export type MeasurementState = 'idle' | 'loading' | 'calibrating' | 'measuring';

export interface PulseDetectionResult {
  state: MeasurementState;
  bpm: number | null;
  confidence: number;
  quality: SignalQualityResult;
  waveform: number[];
  faceROI: FaceROI | null;
  faceDetected: boolean;
  start: () => void;
  stop: () => void;
  isRunning: boolean;
  newSampleCount: number;
  loadingMessage: string;
}

const PROCESS_INTERVAL_MS = 500; // Process every 500ms
const CALIBRATION_SAMPLES = 150; // ~5 seconds at 30fps

export function usePulseDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  cameraActive: boolean,
): PulseDetectionResult {
  const [state, setState] = useState<MeasurementState>('idle');
  const [bpm, setBpm] = useState<number | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [quality, setQuality] = useState<SignalQualityResult>({
    level: 'poor',
    score: 0,
    message: 'Not started.',
  });
  const [waveform, setWaveform] = useState<number[]>([]);
  const [faceROI, setFaceROI] = useState<FaceROI | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [newSampleCount, setNewSampleCount] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('');

  const workerRef = useRef<Worker | null>(null);
  const rafRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleCountRef = useRef(0);
  const lastTimestampRef = useRef(0);
  const fpsEstRef = useRef(30);
  const frameCountRef = useRef(0);
  const fpsTimerStartRef = useRef(0);

  // Initialize worker
  useEffect(() => {
    workerRef.current = new Worker(
      new URL('../workers/signalProcessor.worker.ts', import.meta.url),
      { type: 'module' },
    );

    workerRef.current.onmessage = (e: MessageEvent<WorkerResult>) => {
      const result = e.data;
      if (result.type !== 'result') return;

      setConfidence(result.confidence);
      setQuality(result.quality);
      setWaveform(result.waveform);
      setNewSampleCount(result.newSampleCount);

      if (result.smoothedBpm !== null) {
        setBpm(result.smoothedBpm);
        setState('measuring');
      } else if (result.bufferLength > CALIBRATION_SAMPLES) {
        setState((s) => (s === 'calibrating' ? 'calibrating' : s));
      }
    };

    canvasRef.current = document.createElement('canvas');

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Main capture loop
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !workerRef.current || !canvasRef.current) return;
    if (video.readyState < 2) {
      rafRef.current = requestAnimationFrame(captureFrame);
      return;
    }

    const now = performance.now();

    // FPS estimation
    frameCountRef.current++;
    if (fpsTimerStartRef.current === 0) {
      fpsTimerStartRef.current = now;
    } else if (now - fpsTimerStartRef.current > 2000) {
      fpsEstRef.current =
        (frameCountRef.current * 1000) / (now - fpsTimerStartRef.current);
      frameCountRef.current = 0;
      fpsTimerStartRef.current = now;
      workerRef.current.postMessage({
        type: 'setSampleRate',
        sampleRate: Math.round(fpsEstRef.current),
      } satisfies WorkerMessage);
    }

    // Face detection
    const roi = detectFace(video, now);
    setFaceROI(roi);
    const detected = roi !== null;
    setFaceDetected(detected);

    workerRef.current.postMessage({
      type: 'setFaceDetected',
      faceDetected: detected,
    } satisfies WorkerMessage);

    // Extract ROI colors and send to worker
    if (roi) {
      const colors = extractROIColors(video, roi, canvasRef.current);
      if (colors) {
        sampleCountRef.current++;
        workerRef.current.postMessage({
          type: 'addSample',
          sample: { ...colors, timestamp: now },
          roiCenter: {
            x: roi.x + roi.width / 2,
            y: roi.y + roi.height / 2,
          },
        } satisfies WorkerMessage);
      }
    }

    // Periodic processing
    if (now - lastTimestampRef.current > PROCESS_INTERVAL_MS) {
      lastTimestampRef.current = now;
      workerRef.current.postMessage({ type: 'process' } satisfies WorkerMessage);
    }

    rafRef.current = requestAnimationFrame(captureFrame);
  }, [videoRef]);

  const start = useCallback(async () => {
    if (!cameraActive) return;

    setState('loading');
    setLoadingMessage('Loading face detection model...');
    setBpm(null);
    setConfidence(0);
    sampleCountRef.current = 0;

    try {
      await initFaceDetection();
    } catch (err) {
      console.error('Failed to initialize face detection:', err);
      setState('idle');
      setLoadingMessage('');
      return;
    }

    setLoadingMessage('');
    setState('calibrating');
    setIsRunning(true);

    // Reset worker buffer
    workerRef.current?.postMessage({ type: 'reset' } satisfies WorkerMessage);

    // Start capture loop (process trigger is inside captureFrame)
    rafRef.current = requestAnimationFrame(captureFrame);
  }, [cameraActive, captureFrame]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setIsRunning(false);
    setState('idle');
    setBpm(null);
    setWaveform([]);
    setFaceROI(null);
    setFaceDetected(false);
    sampleCountRef.current = 0;
    workerRef.current?.postMessage({ type: 'reset' } satisfies WorkerMessage);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      destroyFaceDetection();
    };
  }, []);

  // Stop if camera goes inactive
  useEffect(() => {
    if (!cameraActive && isRunning) {
      stop();
    }
  }, [cameraActive, isRunning, stop]);

  return {
    state,
    bpm,
    confidence,
    quality,
    waveform,
    faceROI,
    faceDetected,
    start,
    stop,
    isRunning,
    newSampleCount,
    loadingMessage,
  };
}
