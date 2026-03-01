import { useRef } from 'react';

interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  faceDetected: boolean;
  isActive: boolean;
  isRunning: boolean;
}

export function CameraFeed({
  videoRef,
  faceDetected,
  isActive,
  isRunning,
}: CameraFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl bg-black"
      style={{ aspectRatio: '4/3' }}
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
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
          <p className="text-lg font-medium text-text-primary/80">Analysis paused</p>
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
