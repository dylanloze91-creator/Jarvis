import { useEffect, useState } from 'react';
import type { BackupListItem } from '../../../shared/ipc';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import type { Settings } from '@jarvis/core';

export function BackupSettingsSection({
  draft,
  onChange,
}: {
  draft: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const backup = draft.backup ?? {};
  const [items, setItems] = useState<BackupListItem[]>([]);
  const [pending, setPending] = useState<BackupListItem | null>(null);
  const [notice, setNotice] = useState('');

  const reload = (): void => {
    void window.jarvis.backup.list().then(setItems);
  };

  useEffect(() => {
    reload();
  }, []);

  const patch = (next: Partial<NonNullable<Settings['backup']>>): void => {
    onChange({ backup: { ...backup, ...next } });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-snug text-slate-400">
        Le dossier peut être un disque externe ou un dossier déjà synchronisé par ton cloud. Jarvis n’envoie rien sur Internet.
      </p>
      <Field label="Dossier de sauvegarde">
        <div className="flex gap-2">
          <Input readOnly value={backup.directory ?? ''} placeholder="Aucun dossier choisi" />
          <Button
            type="button"
            size="sm"
            variant="subtle"
            onClick={() => {
              void window.jarvis.backup.pickDirectory().then((directory) => {
                if (directory) patch({ directory });
              });
            }}
          >
            Choisir
          </Button>
        </div>
      </Field>
      <Field label="Fréquence">
        <Select
          value={backup.frequency ?? 'daily'}
          onChange={(event) => patch({ frequency: event.target.value === 'weekly' ? 'weekly' : 'daily' })}
        >
          <option value="daily">Chaque jour</option>
          <option value="weekly">Chaque semaine</option>
        </Select>
      </Field>
      <Field label="Sauvegardes gardées" hint="4 si tu ne changes rien.">
        <Input
          inputMode="numeric"
          value={backup.keep === undefined ? '' : String(backup.keep)}
          placeholder="4"
          onChange={(event) => {
            const keep = Number(event.target.value);
            patch({ keep: Number.isInteger(keep) && keep > 0 ? keep : undefined });
          }}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={backup.includeTrainingData === true}
          onChange={(event) => patch({ includeTrainingData: event.target.checked })}
        />
        Mes données d’entraînement (dossier jarvis-data)
      </label>
      {backup.includeTrainingData ? (
        <Field label="Dossier jarvis-data">
          <Input
            value={backup.trainingDir ?? ''}
            placeholder="Choisis le dossier"
            onChange={(event) => patch({ trainingDir: event.target.value })}
          />
        </Field>
      ) : null}
      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={backup.includeModels === true}
          onChange={(event) => patch({ includeModels: event.target.checked })}
        />
        Mes modèles entraînés (fichiers .gguf)
      </label>
      {backup.includeModels ? (
        <Field label="Dossier des modèles">
          <Input
            value={backup.modelsDir ?? ''}
            placeholder="Choisis le dossier"
            onChange={(event) => patch({ modelsDir: event.target.value })}
          />
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void window.jarvis.backup.now().then((result) => {
              setNotice(result.ok ? `Sauvegarde faite : ${result.file}` : result.error);
              reload();
            });
          }}
        >
          Sauvegarder maintenant
        </Button>
      </div>
      {notice ? <p className="text-xs text-slate-300">{notice}</p> : null}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.name} className="rounded-lg border border-white/10 px-3 py-2">
            <p className="text-sm text-slate-100">{item.name}</p>
            <p className="text-xs text-slate-400">{item.entries.length} éléments. {item.note}</p>
            <Button type="button" size="sm" variant="subtle" className="mt-2" onClick={() => setPending(item)}>
              Restaurer
            </Button>
          </li>
        ))}
      </ul>
      {pending ? (
        <div className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-3">
          <p className="text-sm font-medium text-amber-50">Restaurer cette sauvegarde ?</p>
          <p className="mt-1 text-xs leading-snug text-amber-100/80">
            Jarvis copie d’abord l’état actuel, puis remet {pending.name}. Spotify, Google et les clés sont à reconnecter. Jarvis redémarre ensuite.
          </p>
          <ul className="mt-2 max-h-24 overflow-auto text-xs text-amber-50/80">
            {pending.entries.slice(0, 12).map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setPending(null)}>
              Annuler
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const name = pending.name;
                setPending(null);
                void window.jarvis.backup.restore(name).then((result) => {
                  if (!result.ok) setNotice(result.error);
                });
              }}
            >
              Restaurer
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
