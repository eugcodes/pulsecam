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

  // Enumerate cameras, preferring front-facing on mobile
  const enumerateDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }));

      // On mobile, sort front-facing cameras first so the default is user-facing.
      // Labels typically contain "front" or "facing front" on mobile browsers.
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        videoDevices.sort((a, b) => {
          const aFront = /front|user/i.test(a.label) ? 0 : 1;
          const bFront = /front|user/i.test(b.label) ? 0 : 1;
          return aFront - bFront;
        });
      }

      setDevices(videoDevices);
      if (videoDevices.length > 0 && !selectedDevice) {
        setSelectedDevice(videoDevices[0].deviceId);
      }
    } catch {
      // Permission not yet granted — devices will be populated after first getUserMedia
    }
  }, [selectedDevice]);

  useEffect(() => {
    enumerateDevices();
  }, [enumerateDevices]);

  const start = useCallback(async () => {
    setError(null);

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
          ...(selectedDevice ? { deviceId: { exact: selectedDevice } } : { facingMode: 'user' }),
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
      enumerateDevices();
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
  }, [selectedDevice, enumerateDevices]);

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
      if (isActive) {
        // Restart with new device
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
        setIsActive(false);
        setStream(null);
        // Will be restarted by the component
      }
    },
    [isActive, stream],
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
