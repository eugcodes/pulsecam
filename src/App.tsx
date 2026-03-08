import { useState } from 'react';
import { useCamera } from './hooks/useCamera';
import { usePulseDetection } from './hooks/usePulseDetection';
import { CameraFeed } from './components/CameraFeed';
import { BPMDisplay } from './components/BPMDisplay';
import { WaveformChart } from './components/WaveformChart';
import { SignalQuality } from './components/SignalQuality';
import { Onboarding } from './components/Onboarding';
import { Controls } from './components/Controls';

export default function App() {
  const camera = useCamera();
  const pulse = usePulseDetection(camera.videoRef, camera.isActive);
  const [showHelp, setShowHelp] = useState(false);

  const handleStartCamera = async () => {
    await camera.start();
    pulse.start();
  };

  const handleStopCamera = () => {
    pulse.stop();
    camera.stop();
  };

  const handleToggleMeasure = () => {
    if (pulse.isRunning) pulse.stop();
    else pulse.start();
  };

  return (
    <div className="flex h-screen flex-col bg-bg-primary">
      <Onboarding />
      {showHelp && (
        <Onboarding forceShow onDismiss={() => setShowHelp(false)} />
      )}

      <main className="mx-auto w-full max-w-2xl min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-4">
        {/* Minimal top bar */}
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xs font-semibold tracking-[0.2em] text-text-secondary/60 uppercase">
            PulseCam
          </h1>
          <button
            onClick={() => setShowHelp(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-sm text-text-secondary/40 transition-colors hover:bg-bg-secondary hover:text-text-secondary"
            aria-label="Show help and instructions"
          >
            ?
          </button>
        </div>

        {/* Error */}
        {camera.error && (
          <p className="mb-3 text-center text-sm text-pulse-red" role="alert">
            {camera.error}
          </p>
        )}

        {/* Loading */}
        {pulse.state === 'loading' && pulse.loadingMessage && (
          <p className="mb-3 text-center text-sm text-accent/70">
            {pulse.loadingMessage}
          </p>
        )}

        {/* Camera */}
        <CameraFeed
          videoRef={camera.videoRef}
          faceDetected={pulse.faceDetected}
          isActive={camera.isActive}
          isRunning={pulse.isRunning}
          onToggleMeasure={handleToggleMeasure}
        />

        {/* Controls */}
        <div className="mt-3">
          <Controls
            isRunning={pulse.isRunning}
            cameraActive={camera.isActive}
            onStartCamera={handleStartCamera}
            onStopCamera={handleStopCamera}
            onStartMeasure={pulse.start}
            onStopMeasure={pulse.stop}
            devices={camera.devices}
            selectedDevice={camera.selectedDevice}
            onSelectDevice={camera.selectDevice}
          />
        </div>

        {/* BPM + Signal Quality */}
        <div className="mt-6">
          <BPMDisplay
            bpm={pulse.bpm}
            state={pulse.state}
            confidence={pulse.confidence}
          />
          <SignalQuality
            quality={pulse.quality}
            isActive={pulse.isRunning}
          />
        </div>

        {/* Waveform */}
        {pulse.isRunning && (
          <div className="mt-5">
            <WaveformChart
              waveform={pulse.waveform}
              isActive={pulse.isRunning}
              newSampleCount={pulse.newSampleCount}
            />
          </div>
        )}
      </main>

      {/* Disclaimer */}
      <footer className="shrink-0 px-4 pb-4 pt-2">
        <p className="mx-auto max-w-2xl text-center text-[11px] text-text-secondary/40">
          For educational use only — not a medical device. No data leaves your device.
        </p>
      </footer>
    </div>
  );
}
