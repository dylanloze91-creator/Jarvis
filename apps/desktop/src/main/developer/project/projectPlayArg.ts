const PREFIX = '--jarvis-play-project=';

/** Argument transmis par le raccourci, au démarrage à froid comme en seconde instance. */
export function projectIdFromPlayArgs(argv: readonly string[]): string | null {
  const value = argv.find((arg) => arg.startsWith(PREFIX));
  const id = value?.slice(PREFIX.length).trim() ?? '';
  return /^[a-z0-9][a-z0-9-]{0,39}$/i.test(id) ? id : null;
}

