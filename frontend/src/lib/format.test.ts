import { describe, expect, it } from 'vitest';
import { formatAxisMs, formatDuration, formatInterval, formatMs, formatUptime, timeAgo } from './format';

describe('format helpers', () => {
  it('formats intervals the way the form offers them', () => {
    expect(formatInterval(60)).toBe('1 min');
    expect(formatInterval(300)).toBe('5 min');
    expect(formatInterval(3600)).toBe('1 hour');
    expect(formatInterval(7200)).toBe('2 hours');
    expect(formatInterval(86_400)).toBe('1 day');
    expect(formatInterval(90)).toBe('90 s');
  });

  it('formats durations compactly', () => {
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(95_000)).toBe('1m 35s');
    expect(formatDuration(25 * 60_000)).toBe('25m');
    expect(formatDuration(33 * 60_000 + 19_000)).toBe('33m');
    expect(formatDuration(3_725_000)).toBe('1h 2m');
    expect(formatDuration(90_000_000)).toBe('1d 1h');
  });

  it('keeps 100% clean and shows two decimals otherwise', () => {
    expect(formatUptime(100)).toBe('100%');
    expect(formatUptime(99.5)).toBe('99.50%');
    expect(formatUptime(null)).toBe('—');
  });

  it('switches to seconds above 1000 ms', () => {
    expect(formatMs(240)).toBe('240 ms');
    expect(formatMs(1530)).toBe('1.53 s');
    expect(formatAxisMs(1000)).toBe('1 s');
    expect(formatAxisMs(2500)).toBe('2.5 s');
    expect(formatAxisMs(250)).toBe('250 ms');
  });

  it('describes relative times', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    expect(timeAgo('2026-10-24T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-10-24T11:57:00Z', now)).toBe('3 minutes ago');
    expect(timeAgo('2026-10-24T10:00:00Z', now)).toBe('2 hours ago');
    expect(timeAgo(null, now)).toBe('never');
  });
});
