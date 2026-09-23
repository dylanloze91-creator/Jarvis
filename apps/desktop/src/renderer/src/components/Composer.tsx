import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';

interface ComposerProps {
  busy: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}

const MAX_HEIGHT = 140;

export function Composer({ busy, onSend, onCancel }: ComposerProps) {
  const [value, setValue] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    const focus = (): void => textarea.current?.focus();
    focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);

  const submit = (): void => {
    if (busy || value.trim().length === 0) return;
    onSend(value);
    setValue('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="no-drag flex items-end gap-2 border-t border-white/8 bg-black/20 px-3 py-2.5">
      <textarea
        ref={textarea}
        rows={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Demande quelque chose à Jarvis…"
        className="max-h-35 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
      />
      {busy ? (
        <Button variant="subtle" size="icon" onClick={onCancel} title="Interrompre">
          <Square className="size-3.5 fill-current" />
        </Button>
      ) : (
        <Button
          variant="default"
          size="icon"
          onClick={submit}
          disabled={value.trim().length === 0}
          title="Envoyer (Entrée)"
        >
          <ArrowUp className="size-4" />
        </Button>
      )}
    </div>
  );
}
