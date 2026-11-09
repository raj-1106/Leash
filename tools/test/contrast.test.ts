import { test } from 'node:test';
import * as assert from 'node:assert';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return [r, g, b].map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

test('accessibility: text contrast meets WCAG AA (>= 4.5:1) for all theme token pairs', () => {
  // Light Theme Tokens
  const ltBg = '#FAFAFA';
  const ltPairs = [
    { name: 'ink on bg', fg: '#0A0A0A', bg: ltBg },
    { name: 'mu on bg', fg: '#555555', bg: ltBg },
    { name: 'ok on bg', fg: '#0A7A3D', bg: ltBg },
    { name: 'bad on bg', fg: '#B00020', bg: ltBg },
    { name: 'warn on bg', fg: '#7A5200', bg: ltBg },
  ];

  for (const pair of ltPairs) {
    const ratio = contrastRatio(pair.fg, pair.bg);
    assert.ok(ratio >= 4.5, `Light theme ${pair.name} contrast ratio ${ratio.toFixed(2)} is below 4.5:1`);
  }

  // Dark Theme Tokens
  const dkBg = '#0A0A0A';
  const dkPairs = [
    { name: 'ink on bg', fg: '#F2F2F2', bg: dkBg },
    { name: 'mu on bg', fg: '#A3A3A3', bg: dkBg },
    { name: 'ok on bg', fg: '#5BD68F', bg: dkBg },
    { name: 'bad on bg', fg: '#FF6B6B', bg: dkBg },
    { name: 'warn on bg', fg: '#E5A93C', bg: dkBg },
  ];

  for (const pair of dkPairs) {
    const ratio = contrastRatio(pair.fg, pair.bg);
    assert.ok(ratio >= 4.5, `Dark theme ${pair.name} contrast ratio ${ratio.toFixed(2)} is below 4.5:1`);
  }
});
