import { describe, expect, it } from 'vitest';
import { canQloraTrainOnOllamaModel, planLocalLearningTrain, DEFAULT_LOCAL_TRAIN_BASE } from './plan.js';

describe('planLocalLearningTrain', () => {
  it('entraîne sur qwen2.5:3b quand c’est le modèle de chat', () => {
    const plan = planLocalLearningTrain('qwen2.5:3b');
    expect(plan.trainBaseModel).toBe('qwen2.5:3b');
    expect(plan.sameBaseAsChat).toBe(true);
  });

  it('refuse un 14B et bascule sur le socle 3B', () => {
    const plan = planLocalLearningTrain('qwen2.5:14b');
    expect(plan.trainBaseModel).toBe(DEFAULT_LOCAL_TRAIN_BASE);
    expect(plan.sameBaseAsChat).toBe(false);
    expect(plan.trainNote).toContain('6 Go');
  });

  it('7B ne tient pas en entraînement QLoRA 6 Go', () => {
    expect(canQloraTrainOnOllamaModel('qwen2.5:7b')).toBe(false);
    expect(canQloraTrainOnOllamaModel('qwen2.5:3b')).toBe(true);
  });
});
