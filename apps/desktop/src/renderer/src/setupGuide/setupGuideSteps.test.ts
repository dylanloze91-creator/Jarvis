import { describe, expect, it } from 'vitest';
import { SETUP_GUIDE_STEPS } from './setupGuideSteps';
import { setupGuideImageUrl } from './setupGuideImages';

describe('setup guide', () => {
  it('contient 39 étapes avec images embarquées', () => {
    expect(SETUP_GUIDE_STEPS).toHaveLength(39);
    for (const step of SETUP_GUIDE_STEPS) {
      expect(step.id.length).toBeGreaterThan(0);
      expect(step.text.length).toBeGreaterThan(0);
      expect(() => setupGuideImageUrl(step.image)).not.toThrow();
    }
  });
});
