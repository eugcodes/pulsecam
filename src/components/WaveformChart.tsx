import { useEffect, useRef } from 'react';

interface WaveformChartProps {
  waveform: number[];
  isActive: boolean;
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
 * sub-pixel smoothness. The accumulator grows freely even when the queue
 * is temporarily empty — the identity x = i·step - sub·step is invariant
 * under draining (D samples drained → index becomes i−D, accumulator
 * becomes sub−D, same x), so catch-up drains produce zero visual jump.
 */

const Y_MIN = -2.8;
const Y_MAX = 2.8;
const Y_RANGE = Y_MAX - Y_MIN;
const WINDOW_SEC = 10;

export function WaveformChart({ waveform, isActive }: WaveformChartProps) {
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

  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

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
    } else if (Math.abs(waveform.length - bufLenRef.current) > 2) {
      // Buffer size changed (early growth phase or sample-rate change): snap.
      displayBufRef.current = Float64Array.from(waveform);
      bufLenRef.current = waveform.length;
      pendingRef.current = [];
      subSampleRef.current = 0;
    } else {
      // Stable size: estimate how many samples are new and queue them.
      const elapsed = lastUpdateRef.current > 0 ? now - lastUpdateRef.current : 0;
      const shift = Math.max(1, Math.round(
        (elapsed / (WINDOW_SEC * 1000)) * bufLenRef.current,
      ));

      const startIdx = Math.max(0, waveform.length - shift);
      for (let i = startIdx; i < waveform.length; i++) {
        pendingRef.current.push(waveform[i]);
      }

      // Adapt the drain rate to match actual arrival rate (EMA, α=0.3).
      if (elapsed > 100 && shift > 0) {
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

      // Always accumulate, even when the queue is briefly empty.
      // The identity x = i·step − sub·step is invariant under draining:
      //   (i−D)·step − (sub−D)·step = i·step − sub·step
      // so catch-up drains when data resumes produce zero visual jump.
      subSampleRef.current += (dt / 1000) * drainRate;

      // Soft cap: if data stops entirely, pause after 2 seconds of coasting.
      subSampleRef.current = Math.min(
        subSampleRef.current,
        bufLenRef.current * 0.2,
      );

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
