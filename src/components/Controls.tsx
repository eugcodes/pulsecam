import type { CameraDevice } from '../hooks/useCamera';

interface ControlsProps {
  isRunning: boolean;
  cameraActive: boolean;
  onStartCamera: () => void;
  onStopCamera: () => void;
  onStartMeasure: () => void;
  onStopMeasure: () => void;
  devices: CameraDevice[];
  selectedDevice: string;
  onSelectDevice: (deviceId: string) => void;
}

export function Controls({
  isRunning,
  cameraActive,
  onStartCamera,
  onStopCamera,
  onStartMeasure,
  onStopMeasure,
  devices,
  selectedDevice,
  onSelectDevice,
}: ControlsProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {/* Measurement toggle (play/pause) */}
      <button
        onClick={cameraActive ? (isRunning ? onStopMeasure : onStartMeasure) : undefined}
        disabled={!cameraActive}
        className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border transition-colors ${
          isRunning
            ? 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/20'
            : cameraActive
              ? 'border-border/60 text-text-secondary/60 hover:bg-bg-secondary hover:text-text-secondary'
              : 'border-border/30 text-text-secondary/20 cursor-not-allowed'
        }`}
        aria-label={isRunning ? 'Pause measurement' : 'Start measurement'}
        title={isRunning ? 'Pause' : 'Play'}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          {isRunning ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
          )}
        </svg>
      </button>

      {/* Camera toggle */}
      <button
        onClick={cameraActive ? onStopCamera : onStartCamera}
        className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border transition-colors ${
          cameraActive
            ? 'border-border/60 text-text-secondary/60 hover:bg-bg-secondary hover:text-text-secondary'
            : 'border-border/60 text-text-secondary/60 hover:bg-bg-secondary hover:text-text-secondary'
        }`}
        aria-label={cameraActive ? 'Turn off camera' : 'Turn on camera'}
        title={cameraActive ? 'Turn off camera' : 'Turn on camera'}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          {cameraActive ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          ) : (
            <>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
              />
              <path strokeLinecap="round" d="M3 21 21 3" />
            </>
          )}
        </svg>
      </button>

      {/* Camera selector */}
      {devices.length > 1 && (
        <select
          value={selectedDevice}
          onChange={(e) => onSelectDevice(e.target.value)}
          className="h-[46px] rounded-xl border border-border/60 bg-transparent px-3 text-sm text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
          aria-label="Select camera"
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
