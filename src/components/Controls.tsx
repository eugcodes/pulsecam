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

      {/* Camera selector — always visible when camera is active so users know they can switch */}
      {cameraActive && devices.length > 0 && (
        <div className="relative flex items-center">
          {/* Camera switch icon */}
          <svg
            className="pointer-events-none absolute left-3 h-4 w-4 text-text-secondary/60"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M21.015 4.356v4.992"
            />
          </svg>
          <select
            value={selectedDevice}
            onChange={(e) => onSelectDevice(e.target.value)}
            disabled={devices.length <= 1}
            className={`h-[46px] appearance-none rounded-xl border border-border/60 bg-transparent py-0 pl-9 pr-7 text-sm text-text-secondary transition-colors focus:outline-none focus:ring-2 focus:ring-accent ${
              devices.length > 1
                ? 'cursor-pointer hover:bg-bg-secondary'
                : 'cursor-default opacity-60'
            }`}
            aria-label="Select camera"
            title={devices.length > 1 ? 'Switch camera' : 'Camera'}
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
          {/* Dropdown chevron (only when multiple cameras) */}
          {devices.length > 1 && (
            <svg
              className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-text-secondary/40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          )}
        </div>
      )}
    </div>
  );
}
