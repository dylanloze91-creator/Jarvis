import { useEffect, useState } from 'react';
import type { KnowLine, KnowSummaryItem } from '../../../shared/ipc';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirmButton';

export function KnowSettingsSection() {
  const [items, setItems] = useState<KnowSummaryItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<KnowLine[]>([]);
  const [confirmAll, setConfirmAll] = useState(false);
  const [notice, setNotice] = useState('');

  const reload = (): void => {
    void window.jarvis.know.summary().then(setItems);
  };

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-snug text-slate-400">
        Ce que Jarvis a retenu. L’export ne contient aucune clé. Effacer ici ne touche ni aux réglages ni à tes projets.
      </p>
      {items.filter((item) => item.included).map((item) => (
        <div key={item.id} className="rounded-lg border border-white/10 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm text-slate-100">{item.label}</p>
              <p className="text-xs text-slate-400">{item.hint} · {item.count}</p>
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              <Button
                type="button"
                size="sm"
                variant="subtle"
                onClick={() => {
                  setOpen(item.id);
                  void window.jarvis.know.view(item.id).then(setLines);
                }}
              >
                Voir
              </Button>
              <ConfirmButton
                label="Effacer"
                confirmLabel="Effacer pour de bon"
                onConfirm={() => {
                  void window.jarvis.know.erase(item.id).then((next) => {
                    setItems(next);
                    if (open === item.id) setLines([]);
                  });
                }}
              />
            </div>
          </div>
          {open === item.id ? (
            <ul className="mt-2 max-h-28 overflow-auto text-xs text-slate-300">
              {lines.map((line) => (
                <li key={line.id} className="flex items-center justify-between gap-2 border-t border-white/5 py-1">
                  <span>{line.text}</span>
                  {item.id === 'conversations' ? (
                    <ConfirmButton
                      label="Effacer"
                      onConfirm={() => {
                        void window.jarvis.know.erase('conversations', line.id).then(setItems);
                      }}
                    />
                  ) : null}
                </li>
              ))}
              {lines.length === 0 ? <li>Rien ici.</li> : null}
            </ul>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="subtle"
          onClick={() => {
            void window.jarvis.know.exportAll().then((result) => {
              setNotice(result.ok ? 'Export enregistré.' : (result.error ?? 'Export annulé.'));
            });
          }}
        >
          Tout exporter
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmAll(true)}>
          Tout effacer
        </Button>
      </div>
      {notice ? <p className="text-xs text-slate-300">{notice}</p> : null}
      {confirmAll ? (
        <div className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-3">
          <p className="text-sm font-medium text-amber-50">Effacer ce que Jarvis sait de toi ?</p>
          <p className="mt-1 text-xs leading-snug text-amber-100/80">
            Personnalisation, souvenirs, corrections, conversations, documents, phrases du trieur, questionnaire et extraits du réveil. Les réglages et tes projets restent.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmAll(false)}>
              Annuler
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirmAll(false);
                void window.jarvis.know.eraseAll().then(setItems);
              }}
            >
              Tout effacer
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
