/**
 * Face detection using MediaPipe Face Mesh (via @mediapipe/tasks-vision).
 * Extracts forehead/cheek ROI for rPPG signal extraction.
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';

export interface FaceROI {
  x: number;
  y: number;
  width: number;
  height: number;
  landmarks: Array<{ x: number; y: number }>;
}

let faceLandmarker: FaceLandmarker | null = null;
let initPromise: Promise<FaceLandmarker> | null = null;

/**
 * Initialize the MediaPipe Face Landmarker.
 * Lazy-loaded and cached.
 */
export async function initFaceDetection(): Promise<FaceLandmarker> {
  if (faceLandmarker) return faceLandmarker;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    return faceLandmarker;
  })();

  return initPromise;
}

// MediaPipe Face Mesh landmark indices for forehead and cheeks:
// Forehead region: landmarks around the center forehead
const FOREHEAD_INDICES = [10, 67, 69, 104, 108, 151, 299, 337, 338];
// Left cheek
const LEFT_CHEEK_INDICES = [50, 101, 116, 117, 118, 119, 123, 147, 187, 205, 206, 207, 209];
// Right cheek
const RIGHT_CHEEK_INDICES = [280, 330, 345, 346, 347, 348, 352, 376, 411, 425, 426, 427, 429];

/**
 * Detect face and extract ROI from a video frame.
 */
export function detectFace(
  video: HTMLVideoElement,
  timestamp: number,
): FaceROI | null {
  if (!faceLandmarker) return null;

  let results: FaceLandmarkerResult;
  try {
    results = faceLandmarker.detectForVideo(video, timestamp);
  } catch {
    return null;
  }

  if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
    return null;
  }

  const landmarks = results.faceLandmarks[0];
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;

  // Combine forehead and cheek landmarks for ROI
  const roiIndices = [
    ...FOREHEAD_INDICES,
    ...LEFT_CHEEK_INDICES,
    ...RIGHT_CHEEK_INDICES,
  ];

  const roiPoints = roiIndices
    .filter((i) => i < landmarks.length)
    .map((i) => ({
      x: landmarks[i].x * videoWidth,
      y: landmarks[i].y * videoHeight,
    }));

  if (roiPoints.length === 0) return null;

  // Bounding box of ROI points
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of roiPoints) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  // Add small padding
  const padX = (maxX - minX) * 0.05;
  const padY = (maxY - minY) * 0.05;
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(videoWidth, maxX + padX);
  maxY = Math.min(videoHeight, maxY + padY);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    landmarks: roiPoints,
  };
}

/**
 * Extract average RGB values from the face ROI in a video frame.
 */
export function extractROIColors(
  video: HTMLVideoElement,
  roi: FaceROI,
  canvas: HTMLCanvasElement,
): { r: number; g: number; b: number } | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  ctx.drawImage(video, 0, 0);

  const x = Math.round(roi.x);
  const y = Math.round(roi.y);
  const w = Math.round(roi.width);
  const h = Math.round(roi.height);

  if (w <= 0 || h <= 0) return null;

  const imageData = ctx.getImageData(x, y, w, h);
  const data = imageData.data;

  let totalR = 0,
    totalG = 0,
    totalB = 0;
  const pixelCount = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    totalR += data[i];
    totalG += data[i + 1];
    totalB += data[i + 2];
  }

  return {
    r: totalR / pixelCount,
    g: totalG / pixelCount,
    b: totalB / pixelCount,
  };
}

/**
 * Cleanup face detection resources.
 */
export function destroyFaceDetection(): void {
  if (faceLandmarker) {
    faceLandmarker.close();
    faceLandmarker = null;
    initPromise = null;
  }
}
