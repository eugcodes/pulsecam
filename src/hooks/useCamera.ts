import { useState, useEffect, useRef, useCallback } from 'react';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  isActive: boolean;
  error: string | null;
  devices: CameraDevice[];
  selectedDevice: string;
  selectDevice: (deviceId: string) => void;
  start: () => Promise<void>;
  stop: () => void;
}

export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');

  // Enumerate cameras and update state. Subscribes to devicechange for hot-plug support.
  useEffect(() => {
    const enumerate = async () => {
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices
          .filter((d) => d.kind === 'videoinput')
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Camera ${i + 1}`,
          }));

        // On mobile, prefer the standard (non-ultra-wide) front-facing camera.
        // Ultra-wide lenses produce smaller faces with more distortion, hurting rPPG accuracy.
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) {
          videoDevices.sort((a, b) => {
            const score = (d: CameraDevice) => {
              const isFront = /front|user/i.test(d.label);
              const isUltraWide = /ultra.?wide|wide.?angle|0\.5\s*x/i.test(d.label);
              return (isFront ? 0 : 2) + (isUltraWide ? 1 : 0);
            };
            return score(a) - score(b);
          });
        }

        setDevices(videoDevices);
        setSelectedDevice((prev) => prev || (videoDevices[0]?.deviceId ?? ''));
      } catch {
        // Permission not yet granted — devices will be populated after first getUserMedia
      }
    };

    enumerate();
    navigator.mediaDevices.addEventListener('devicechange', enumerate);
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate);
  }, []);

  const start = useCallback(async (deviceIdOverride?: string) => {
    setError(null);
    const deviceId = deviceIdOverride ?? selectedDevice;

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
        },
        audio: false,
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);
      setIsActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }

      // Re-enumerate devices after permission grant (to get labels)
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    } catch (err) {
      const msg =
        err instanceof DOMException
          ? err.name === 'NotAllowedError'
            ? 'Camera permission denied. Please allow camera access in your browser settings.'
            : err.name === 'NotFoundError'
              ? 'No camera found. Please connect a camera and try again.'
              : `Camera error: ${err.message}`
          : 'Failed to access camera.';
      setError(msg);
      setIsActive(false);
    }
  }, [selectedDevice]);

  const stop = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStream(null);
    setIsActive(false);
  }, [stream]);

  const selectDevice = useCallback(
    (deviceId: string) => {
      setSelectedDevice(deviceId);
      if (isActive && stream) {
        stream.getTracks().forEach((t) => t.stop());
        start(deviceId);
      }
    },
    [isActive, stream, start],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [stream]);

  return {
    videoRef,
    stream,
    isActive,
    error,
    devices,
    selectedDevice,
    selectDevice,
    start,
    stop,
  };
}
