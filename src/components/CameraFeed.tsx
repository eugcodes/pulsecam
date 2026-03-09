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
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl bg-black sm:max-h-[50vh] lg:max-h-[40vh]"
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
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-secondary">
          <p className="text-sm text-text-secondary/60">Camera off</p>
          <p className="mt-3 text-[11px] text-text-secondary/40">For educational use only — not a medical device.</p>
          <p className="text-[11px] text-text-secondary/40">No data leaves your device.</p>
        </div>
      )}
    </div>
  );
}
