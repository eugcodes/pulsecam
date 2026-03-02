import { useEffect, useRef } from 'react';

interface WaveformChartProps {
  waveform: number[];
  isActive: boolean;
  newSampleCount: number;
}

const LINE_COLOR = '#2dd4bf';
const GRID_COLOR = 'rgba(48, 54, 61, 0.3)';
const BG_COLOR = '#0d1117';

/**
 * Smooth-scrolling waveform with rock-stable peaks.
 *
 * **Fixed Y-axis (±2.8)**: Data is already normalized (zero mean, unit std).
 * A fixed range means each value always maps to the same pixel.
 *
 * **Append-only display buffer**: Old on-screen values are preserved from
 * when they first entered. The DSP pipeline reruns filtfilt + normalize
 * each snapshot, changing values everywhere, but we never overwrite
 * existing display samples.
 *
 * **Drip-feed scrolling**: New samples are queued and drained one at a time
 * at the measured data arrival rate. A fractional accumulator provides
 * sub-pixel smoothness. The accumulator only grows while the queue has
 * data; when the queue empties the waveform holds position, and when
 * data resumes it continues smoothly from the held fractional offset.
 *
 * **Exact sample counts**: The worker reports exactly how many new
 * samples were added (no time-based estimation), eliminating timing
 * jitter from tab switching, GC pauses, or inconsistent frame rates.
 */

const Y_MIN = -2.8;
const Y_MAX = 2.8;
const Y_RANGE = Y_MAX - Y_MIN;
const WINDOW_SEC = 10;

export function WaveformChart({ waveform, isActive, newSampleCount }: WaveformChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  // The actual rendered buffer — only mutated by the rAF drip-feed.
  const displayBufRef = useRef<Float64Array>(new Float64Array(0));
  // Queue of new sample values waiting to be drained into the display.
  const pendingRef = useRef<number[]>([]);
  // Fractional sample accumulator for sub-pixel scrolling.
  const subSampleRef = useRef(0);
  // Timestamp of last rAF frame (for per-frame dt).
  const lastFrameRef = useRef(0);
  // Stable buffer length (= sampleRate × 10).
  const bufLenRef = useRef(0);
  // Timestamp of last waveform update (for estimating new-sample count).
  const lastUpdateRef = useRef(0);
  // Measured data arrival rate (samples/sec), adapted via EMA.
  const arrivalRateRef = useRef(0);
  // Latest exact sample count from the worker.
  const newSampleCountRef = useRef(0);

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  newSampleCountRef.current = newSampleCount;

  // When a new waveform snapshot arrives, queue only the new samples.
  useEffect(() => {
    if (waveform.length === 0) return;

    const now = performance.now();
    const buf = displayBufRef.current;

    if (buf.length === 0) {
      // First snapshot: load the full display buffer directly.
      displayBufRef.current = Float64Array.from(waveform);
      bufLenRef.current = waveform.length;
      lastFrameRef.current = now;
    } else if (Math.abs(waveform.length - bufLenRef.current) > bufLenRef.current * 0.1) {
      // Buffer size changed (early growth phase or sample-rate change): snap.
      displayBufRef.current = Float64Array.from(waveform);
      bufLenRef.current = waveform.length;
      pendingRef.current = [];
      subSampleRef.current = 0;
    } else {
      // Stable size: use exact sample count from worker.
      const shift = newSampleCountRef.current;
      if (shift <= 0) {
        // No new data — don't update lastUpdateRef so the next
        // elapsed measurement includes this gap.
        return;
      }

      const elapsed = lastUpdateRef.current > 0 ? now - lastUpdateRef.current : 0;

      const startIdx = Math.max(0, waveform.length - shift);
      for (let i = startIdx; i < waveform.length; i++) {
        pendingRef.current.push(waveform[i]);
      }

      // Adapt the drain rate to match actual arrival rate (EMA, α=0.3).
      if (elapsed > 100) {
        const instantRate = (shift / elapsed) * 1000;
        arrivalRateRef.current = arrivalRateRef.current > 0
          ? 0.7 * arrivalRateRef.current + 0.3 * instantRate
          : instantRate;
      }

      // Safety cap: never let the queue exceed one window of data.
      if (pendingRef.current.length > bufLenRef.current) {
        pendingRef.current.splice(
          0,
          pendingRef.current.length - bufLenRef.current,
        );
      }
    }

    lastUpdateRef.current = now;
  }, [waveform]);

  // Single persistent rAF loop — runs from mount to unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const now = performance.now();
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const w = rect.width;
      const h = rect.height;

      // Background
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, w, h);

      // Horizontal grid lines
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 0.5;
      for (let y = 0; y < h; y += h / 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const buf = displayBufRef.current;

      if (buf.length < 2) {
        ctx.fillStyle = 'rgba(139, 148, 158, 0.4)';
        ctx.font = '13px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          isActiveRef.current ? 'Waiting for signal...' : '',
          w / 2,
          h / 2 + 5,
        );
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // ── Drip-feed: drain pending samples at the measured rate ──────────
      const dt = lastFrameRef.current > 0 ? now - lastFrameRef.current : 0;
      lastFrameRef.current = now;

      // Use the adaptive arrival rate, falling back to the static estimate.
      const drainRate = arrivalRateRef.current || (bufLenRef.current / WINDOW_SEC);
      const pending = pendingRef.current;

      // Only accumulate when there's data to consume.  When the queue
      // is empty the waveform holds position; when data resumes the
      // accumulator continues from its fractional value — no jump.
      if (pending.length > 0) {
        subSampleRef.current += (dt / 1000) * drainRate;
      }

      const toDrain = Math.min(
        Math.floor(subSampleRef.current),
        pending.length,
      );

      if (toDrain > 0) {
        subSampleRef.current -= toDrain;
        // Shift buffer left by toDrain, append new samples at the right.
        buf.copyWithin(0, toDrain);
        for (let j = 0; j < toDrain; j++) {
          buf[buf.length - toDrain + j] = pending[j];
        }
        pending.splice(0, toDrain);
      }

      // ── Draw waveform ─────────────────────────────────────────────────
      const padding = 12;
      const plotH = h - padding * 2;
      const step = w / (buf.length - 1);
      const fractPx = subSampleRef.current * step;

      ctx.shadowColor = LINE_COLOR;
      ctx.shadowBlur = 6;
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();

      for (let i = 0; i < buf.length; i++) {
        const x = i * step - fractPx;
        const clamped = Math.max(Y_MIN, Math.min(Y_MAX, buf[i]));
        const y = padding + plotH - ((clamped - Y_MIN) / Y_RANGE) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Gradient fill under the curve
      ctx.shadowBlur = 0;
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, 'rgba(45, 212, 191, 0.08)');
      gradient.addColorStop(1, 'rgba(45, 212, 191, 0)');

      const lastX = (buf.length - 1) * step - fractPx;
      ctx.lineTo(lastX, h);
      ctx.lineTo(-fractPx, h);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-28 w-full rounded-lg sm:h-32"
      aria-label="Pulse waveform"
      role="img"
    />
  );
}
