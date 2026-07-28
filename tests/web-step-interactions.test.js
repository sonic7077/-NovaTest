import { describe, expect, it } from 'vitest';
import { canDeleteWebStep, clipboardImageFile } from '../client/web-step-interactions.js';

describe('Web step interactions', () => {
  it('returns the first supported image file from a clipboard payload', () => {
    const image = { name: 'reference.png', type: 'image/png' };
    const clipboardData = {
      items: [
        { type: 'text/plain', getAsFile: () => null },
        { type: 'image/png', getAsFile: () => image }
      ]
    };

    expect(clipboardImageFile(clipboardData)).toBe(image);
  });

  it('ignores unsupported clipboard entries and protects the final step', () => {
    expect(clipboardImageFile({ items: [{ type: 'image/gif', getAsFile: () => ({}) }] })).toBeUndefined();
    expect(canDeleteWebStep(1)).toBe(false);
    expect(canDeleteWebStep(2)).toBe(true);
  });
});
