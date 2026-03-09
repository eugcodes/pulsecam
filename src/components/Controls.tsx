import type { CameraDevice } from '../hooks/useCamera';

interface ControlsProps {
  cameraActive: boolean;
  devices: CameraDevice[];
  selectedDevice: string;
  onSelectDevice: (deviceId: string) => void;
}

export function Controls({
  cameraActive,
  devices,
  selectedDevice,
  onSelectDevice,
}: ControlsProps) {
  // Only render when there are multiple cameras to choose from
  if (!cameraActive || devices.length <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2">
      {/* Camera selector */}
      {(
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
