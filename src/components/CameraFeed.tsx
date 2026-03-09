interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  faceDetected: boolean;
  isActive: boolean;
  isRunning: boolean;
  onToggleCamera: () => void;
}

export function CameraFeed({
  videoRef,
  faceDetected,
  isActive,
  isRunning,
  onToggleCamera,
}: CameraFeedProps) {
  return (
    <div
      className="relative w-full cursor-pointer overflow-hidden rounded-xl bg-black sm:max-h-[50vh] lg:max-h-[40vh]"
      style={{ aspectRatio: '4/3' }}
      onClick={onToggleCamera}
      role="button"
      tabIndex={0}
      aria-label={isActive ? 'Turn off camera' : 'Turn on camera'}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCamera(); } }}
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
          <svg className="mb-2 h-8 w-8 text-text-secondary/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          <p className="text-sm text-text-secondary/60">Tap to start</p>
          <p className="mt-8 text-[11px] text-text-secondary/40">For educational use only — not a medical device.</p>
          <p className="text-[11px] text-text-secondary/40">No data leaves your device.</p>
        </div>
      )}
    </div>
  );
}
