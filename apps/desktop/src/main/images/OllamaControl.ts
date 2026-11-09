/**
 * Décharger et recharger les modèles d'Ollama autour d'une génération d'image :
 * la RTX 2060 (6 Go) ne peut pas garder le 7B et SDXL en même temps.
 * Rien ici ne modifie les réglages du serveur Ollama : seules des requêtes
 * `keep_alive` sur `/api/generate`, comme le fait le chat.
 */

export interface LoadedModel {
  name: string;
  sizeVram?: number;
}

export class OllamaControl {
  constructor(
    private readonly baseUrl: string = 'http://127.0.0.1:11434',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Modèles actuellement chargés (`/api/ps`). Ollama arrêté : liste vide. */
  async loaded(): Promise<LoadedModel[]> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/ps`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return [];
      const body = (await response.json()) as { models?: { name?: string; model?: string; size_vram?: number }[] };
      return (body.models ?? [])
        .map((model) => ({ name: model.name ?? model.model ?? '', ...(model.size_vram !== undefined ? { sizeVram: model.size_vram } : {}) }))
        .filter((model) => model.name);
    } catch {
      return [];
    }
  }

  /** Décharge tous les modèles chargés (`keep_alive: 0`). Renvoie les noms déchargés. */
  async unloadAll(): Promise<string[]> {
    const models = await this.loaded();
    const unloaded: string[] = [];
    for (const model of models) {
      try {
        await this.generate(model.name, 0, 30_000);
        unloaded.push(model.name);
      } catch {
        // Un modèle qui refuse de se décharger : Forge le verra dans la mémoire restante ; on continue.
      }
    }
    return unloaded;
  }

  /** Charge un modèle (requête vide) en le gardant `keepAlive` ; vrai si Ollama a répondu. */
  async preload(model: string, keepAlive: string | number): Promise<boolean> {
    try {
      await this.generate(model, keepAlive, 180_000);
      return true;
    } catch {
      return false;
    }
  }

  private async generate(model: string, keepAlive: string | number, timeoutMs: number): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: keepAlive, stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Ollama a répondu ${response.status}`);
    await response.text();
  }
}
