import { useState, useEffect } from 'react';

const STORAGE_KEY = 'pulsecam-onboarding-dismissed';

interface OnboardingProps {
  forceShow?: boolean;
  onDismiss?: () => void;
}

export function Onboarding({ forceShow, onDismiss }: OnboardingProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (forceShow) {
      setVisible(true);
      return;
    }
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) {
      setVisible(true);
    }
  }, [forceShow]);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(STORAGE_KEY, 'true');
    onDismiss?.();
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="my-auto w-full max-w-sm rounded-2xl border border-border bg-bg-secondary p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <h2 id="onboarding-title" className="text-lg font-bold tracking-tight text-text-primary">
            PulseCam
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Measures your heart rate using your camera
          </p>
          <p className="mt-0.5 text-[11px] text-text-secondary/40">
            All processing happens locally. No data leaves your device.
          </p>
        </div>

        {/* How it works */}
        <div className="mb-5 space-y-2.5">
          <Step n={1} title="Video Analysis">
            Blood flow causes subtle changes in skin color
          </Step>
          <Step n={2} title="Signal Processing">
            rPPG algorithms extract your pulse in real time
          </Step>
          <Step n={3} title="Display heart rate">
            Displays your pulse and live pulse waveform
          </Step>
        </div>

        {/* Divider */}
        <div className="mb-4 border-t border-border/50" />

        {/* Tips */}
        <div className="mb-6">
          <h3 className="mb-2 text-xs font-semibold text-text-secondary/70 uppercase tracking-wide">
            For best results
          </h3>
          <ul className="space-y-1.5 text-sm text-text-secondary">
            <li className="flex items-start gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-secondary/40" aria-hidden="true" />
              Good, even lighting on your face
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-secondary/40" aria-hidden="true" />
              Stay as still as possible
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-secondary/40" aria-hidden="true" />
              Face the camera directly
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-secondary/40" aria-hidden="true" />
              Wait 5–8 seconds for calibration
            </li>
          </ul>
        </div>

        {/* Dismiss */}
        <button
          onClick={dismiss}
          className="w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-bg-primary transition-colors hover:bg-accent-dim focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg-secondary"
          aria-label="Get started with PulseCam"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-sm font-bold text-accent">
        {n}
      </div>
      <div>
        <p className="text-sm font-medium leading-tight text-text-primary">{title}</p>
        <p className="mt-0.5 text-xs leading-snug text-text-secondary/70">{children}</p>
      </div>
    </div>
  );
}
