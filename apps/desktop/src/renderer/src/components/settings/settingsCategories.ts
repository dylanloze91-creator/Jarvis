import {
  AppWindow,
  Bot,
  ShieldCheck,
  Mic,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { SettingsCategoryId } from '@jarvis/core';

export type { SettingsCategoryId };

export const SETTINGS_CATEGORIES: ReadonlyArray<{
  id: SettingsCategoryId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: 'moi', label: 'Moi', icon: UserRound },
  { id: 'parler', label: 'Parler', icon: Mic },
  { id: 'services', label: 'Services', icon: AppWindow },
  { id: 'brain', label: 'Cerveau', icon: Bot },
  { id: 'security', label: 'Sécurité', icon: ShieldCheck },
  { id: 'application', label: 'Application', icon: AppWindow },
];
