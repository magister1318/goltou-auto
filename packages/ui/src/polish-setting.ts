import type { PolishStrength, PostInput } from '@goltou/api-client';

export function initialPreviewOptions(): PostInput['options'] & { polishStrength: PolishStrength } {
  return { polish: false, polishStrength: 'natural', closing: false, linkCard: false };
}
