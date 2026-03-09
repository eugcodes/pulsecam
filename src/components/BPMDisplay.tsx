import type { MeasurementState } from '../hooks/usePulseDetection';

interface BPMDisplayProps {
  bpm: number | null;
  state: MeasurementState;
  confidence: number;
}

export function BPMDisplay({ bpm, state, confidence }: BPMDisplayProps) {
  const pulseDuration = bpm && bpm > 0 ? 60 / bpm : 1;
  const isShowingBpm = state === 'measuring' && bpm;

  return (
    <div className="flex flex-col items-center" aria-live="polite">
      {/* BPM Value */}
      {isShowingBpm ? (
        <div className="relative flex items-baseline gap-1">
          <div
            className="animate-pulse-ring absolute inset-0 rounded-full border-2 border-accent"
            style={{ '--pulse-duration': `${pulseDuration}s` } as React.CSSProperties}
          />
          <span
            className="animate-pulse-glow text-7xl font-bold tracking-tighter text-accent sm:text-8xl"
            style={{ '--pulse-duration': `${pulseDuration}s` } as React.CSSProperties}
            aria-label={`Heart rate: ${bpm} beats per minute`}
          >
            {bpm}
          </span>
          <span className="text-lg font-medium text-text-secondary/40">BPM</span>
        </div>
      ) : state === 'calibrating' ? (
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold tracking-tight text-accent-dim">
            Calibrating
          </span>
        </div>
      ) : (
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-semibold tracking-tight text-text-secondary/15">
            --
          </span>
          <span className="text-sm font-medium text-text-secondary/25">BPM</span>
        </div>
      )}

      {/* Status */}
      <div className="mt-1 h-5">
        {state === 'loading' && (
          <p className="text-xs text-text-secondary/50">Loading face detection...</p>
        )}
        {state === 'calibrating' && (
          <p className="text-xs text-accent-dim">Hold still</p>
        )}
        {isShowingBpm && (
          <p className="text-xs text-text-secondary/50">
            Confidence {Math.round(confidence * 100)}%
          </p>
        )}
        {state === 'idle' && null}
      </div>
    </div>
  );
}
