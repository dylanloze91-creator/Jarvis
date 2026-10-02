/**
 * Décision 5 : « la tâche cède la place ». Le processus principal signale le
 * début et la fin de chaque tour de chat ; la tâche de développement attend
 * la fin de son étape en cours, libère le modèle de code et reprend après.
 * Rien dans le chat ne change : seul l'appel IPC est entouré de begin/end.
 */
export class ChatActivity {
  private active = 0;
  private lastEnd = 0;
  private readonly waiters = new Set<() => void>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  get busy(): boolean {
    return this.active > 0;
  }

  begin(): void {
    this.active += 1;
  }

  end(): void {
    this.active = Math.max(0, this.active - 1);
    this.lastEnd = this.now();
    if (this.active === 0) for (const wake of [...this.waiters]) wake();
  }

  /** Vrai si un tour est en cours ou vient de finir (fenêtre de suite vocale). */
  wantsPriority(graceMs: number): boolean {
    return this.busy || (this.lastEnd > 0 && this.now() - this.lastEnd < graceMs);
  }

  /** Attend qu'aucun tour ne soit en cours depuis `graceMs` (une question de suite peut arriver). */
  async whenIdle(graceMs: number, signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw new Error('Annulé.');
      if (!this.busy) {
        const wait = graceMs - (this.now() - this.lastEnd);
        if (this.lastEnd === 0 || wait <= 0) return;
        await this.sleep(wait, signal);
        continue;
      }
      await new Promise<void>((resolve, reject) => {
        const done = (): void => {
          this.waiters.delete(done);
          signal?.removeEventListener('abort', abort);
          resolve();
        };
        const abort = (): void => {
          this.waiters.delete(done);
          reject(new Error('Annulé.'));
        };
        this.waiters.add(done);
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, ms);
      const abort = (): void => {
        clearTimeout(timer);
        reject(new Error('Annulé.'));
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
}
