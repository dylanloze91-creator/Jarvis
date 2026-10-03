/** Requête de nvidia-smi : nom, mémoire totale, utilisée et libre (Mio), pilote. */
export const NVIDIA_SMI_PROGRAM = 'nvidia-smi';
export const NVIDIA_SMI_ARGS = [
  '--query-gpu=name,memory.total,memory.used,memory.free,driver_version',
  '--format=csv,noheader,nounits',
];
