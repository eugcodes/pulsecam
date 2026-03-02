import { describe, it, expect } from 'vitest';
import { assessSignalQuality, estimateMotion } from './signalQuality';

// ─── assessSignalQuality ─────────────────────────────────────────────────────

describe('assessSignalQuality', () => {
  it('returns poor quality when no face is detected', () => {
    const result = assessSignalQuality(0.9, false, 0);
    expect(result.level).toBe('poor');
    expect(result.score).toBe(0);
    expect(result.message).toContain('No face detected');
  });

  it('returns good quality for high confidence and low motion', () => {
    const result = assessSignalQuality(0.8, true, 0);
    expect(result.level).toBe('good');
    expect(result.score).toBeGreaterThanOrEqual(0.5);
    expect(result.message).toContain('Good');
  });

  it('returns fair quality for moderate confidence', () => {
    const result = assessSignalQuality(0.35, true, 0);
    expect(result.level).toBe('fair');
    expect(result.score).toBeGreaterThanOrEqual(0.2);
    expect(result.score).toBeLessThan(0.5);
  });

  it('returns poor quality for very low confidence', () => {
    const result = assessSignalQuality(0.05, true, 0);
    expect(result.level).toBe('poor');
    expect(result.score).toBeLessThan(0.2);
  });

  it('motion degrades the score', () => {
    const noMotion = assessSignalQuality(0.8, true, 0);
    const withMotion = assessSignalQuality(0.8, true, 0.8);

    expect(withMotion.score).toBeLessThan(noMotion.score);
  });

  it('high motion can downgrade quality level from good to fair/poor', () => {
    const calm = assessSignalQuality(0.6, true, 0);
    expect(calm.level).toBe('good');

    const shaky = assessSignalQuality(0.6, true, 1.0);
    expect(['fair', 'poor']).toContain(shaky.level);
  });

  it('score is clamped between 0 and 1', () => {
    // Very high confidence, no motion
    const high = assessSignalQuality(10, true, 0);
    expect(high.score).toBeLessThanOrEqual(1);

    // Negative confidence (shouldn't happen, but shouldn't crash)
    const neg = assessSignalQuality(-1, true, 0);
    expect(neg.score).toBeGreaterThanOrEqual(0);
  });

  it('face not detected always beats other factors', () => {
    // Even with perfect confidence and zero motion
    const result = assessSignalQuality(1.0, false, 0);
    expect(result.level).toBe('poor');
    expect(result.score).toBe(0);
  });

  it('returns appropriate messages for each level', () => {
    const good = assessSignalQuality(0.8, true, 0);
    const fair = assessSignalQuality(0.35, true, 0);
    const poor = assessSignalQuality(0.05, true, 0);

    expect(good.message.toLowerCase()).toContain('good');
    expect(fair.message.toLowerCase()).toContain('fair');
    expect(poor.message.toLowerCase()).toContain('poor');
  });
});

// ─── estimateMotion ──────────────────────────────────────────────────────────

describe('estimateMotion', () => {
  it('returns 0 for empty history', () => {
    expect(estimateMotion([])).toBe(0);
  });

  it('returns 0 for single-point history', () => {
    expect(estimateMotion([{ x: 100, y: 100 }])).toBe(0);
  });

  it('returns 0 for stationary points', () => {
    const history = Array(10).fill({ x: 50, y: 50 });
    expect(estimateMotion(history)).toBe(0);
  });

  it('returns small value for minor movement', () => {
    const history = [];
    for (let i = 0; i < 10; i++) {
      history.push({ x: 100 + i * 0.5, y: 100 + i * 0.3 });
    }
    const motion = estimateMotion(history);
    expect(motion).toBeGreaterThan(0);
    expect(motion).toBeLessThan(0.1); // small displacement
  });

  it('returns higher value for larger movement', () => {
    const small = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const large = [{ x: 0, y: 0 }, { x: 20, y: 0 }];

    expect(estimateMotion(large)).toBeGreaterThan(estimateMotion(small));
  });

  it('is capped at 1 for very large motion', () => {
    const extreme = [{ x: 0, y: 0 }, { x: 1000, y: 1000 }];
    expect(estimateMotion(extreme)).toBe(1);
  });

  it('only considers recent samples (maxSamples)', () => {
    const history = [];
    // 20 points: first 10 are wild, last 10 are still
    for (let i = 0; i < 10; i++) {
      history.push({ x: i * 100, y: i * 100 }); // wild motion
    }
    for (let i = 0; i < 10; i++) {
      history.push({ x: 500, y: 500 }); // stationary
    }

    // With maxSamples=10, should only see the stationary part
    const motionRecent = estimateMotion(history, 10);
    // With maxSamples=20, sees both wild and stationary
    const motionAll = estimateMotion(history, 20);

    expect(motionRecent).toBeLessThan(motionAll);
  });

  it('computes euclidean displacement correctly', () => {
    // Two points, 3-4-5 right triangle
    const history = [{ x: 0, y: 0 }, { x: 3, y: 4 }];
    const motion = estimateMotion(history);
    // avg displacement = 5, normalized by 20 = 0.25
    expect(motion).toBeCloseTo(0.25, 5);
  });

  it('handles default maxSamples parameter', () => {
    const history = [];
    for (let i = 0; i < 30; i++) {
      history.push({ x: i, y: 0 });
    }

    // Default maxSamples=15, so it should only use the last 15 points
    const motion = estimateMotion(history);
    // avg displacement over last 15: each step is 1 pixel, avg=1, motion=1/20=0.05
    expect(motion).toBeCloseTo(1 / 20, 2);
  });
});
