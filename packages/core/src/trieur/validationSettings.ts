export type ValidationPath = 'express' | 'cerveau' | 'trieur';

export function teamValidationEnabled(
  orchestra: { trieurDataDir?: string; teamValidation?: boolean } | undefined,
): boolean {
  const dir = orchestra?.trieurDataDir?.trim();
  return Boolean(dir && orchestra?.teamValidation);
}

export function validationPathForHow(how: 'express' | 'cerveau' | 'trieur'): ValidationPath {
  return how;
}
