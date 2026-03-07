import { useRef } from 'react';

interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  faceDetected: boolean;
  isActive: boolean;
  isRunning: boolean;
  onToggleMeasure?: () => void;
}

export function CameraFeed({
  videoRef,
  faceDetected,
  isActive,
  isRunning,
  onToggleMeasure,
}: CameraFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl bg-black sm:max-h-[50vh] lg:max-h-[40vh]"
      style={{ aspectRatio: '4/3', cursor: isActive ? 'pointer' : undefined }}
      onClick={isActive ? onToggleMeasure : undefined}
      role={isActive ? 'button' : undefined}
      tabIndex={isActive ? 0 : undefined}
      aria-label={isActive ? (isRunning ? 'Pause analysis' : 'Resume analysis') : undefined}
      onKeyDown={isActive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleMeasure?.(); } } : undefined}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        autoPlay
        playsInline
        muted
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* Analysis paused (camera on, measurement off) */}
      {isActive && !isRunning && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
          <div className="flex h-[46px] w-[46px] items-center justify-center rounded-xl border border-border/60 bg-bg-primary/60 backdrop-blur-sm">
            <svg className="h-5 w-5 text-text-secondary/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
            </svg>
          </div>
        </div>
      )}

      {/* No face detected (camera on, measuring, no face) */}
      {isActive && isRunning && !faceDetected && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg bg-black/60 px-4 py-2 backdrop-blur-sm">
            <p className="text-sm text-text-secondary">
              No face detected
            </p>
          </div>
        </div>
      )}

      {/* Camera off */}
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-secondary">
          <p className="text-sm text-text-secondary/60">Camera off</p>
        </div>
      )}
    </div>
  );
}
