import { SECRET_MARKER } from '@jarvis/core';
import { Input } from '@/components/ui/field';

/** Champ de clé : la fenêtre voit « clé enregistrée », jamais la clé. */
export function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const stored = value === SECRET_MARKER;
  return (
    <Input
      type={stored ? 'text' : 'password'}
      value={value}
      placeholder={stored ? undefined : placeholder}
      autoComplete="off"
      onChange={(event: { target: { value: string } }) => onChange(event.target.value)}
    />
  );
}
