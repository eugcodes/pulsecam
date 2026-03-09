import type { CameraDevice } from '../hooks/useCamera';

interface ControlsProps {
  cameraActive: boolean;
  onStartCamera: () => void;
  onStopCamera: () => void;
  devices: CameraDevice[];
  selectedDevice: string;
  onSelectDevice: (deviceId: string) => void;
}

export function Controls({
  cameraActive,
  onStartCamera,
  onStopCamera,
  devices,
  selectedDevice,
  onSelectDevice,
}: ControlsProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {/* Camera toggle */}
      <button
        onClick={cameraActive ? onStopCamera : onStartCamera}
        className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border transition-colors border-border/60 text-text-secondary/60 hover:bg-bg-secondary hover:text-text-secondary"
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

      {/* Camera selector — only show when multiple cameras available */}
      {cameraActive && devices.length > 1 && (
        <div className="relative flex items-center">
          <select
            value={selectedDevice}
            onChange={(e) => onSelectDevice(e.target.value)}
            disabled={devices.length <= 1}
            className={`h-[46px] appearance-none rounded-xl border border-border/60 bg-transparent py-0 pl-3 pr-7 text-sm text-text-secondary transition-colors focus:outline-none focus:ring-2 focus:ring-accent ${
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
