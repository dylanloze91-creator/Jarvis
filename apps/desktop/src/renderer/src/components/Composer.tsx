import { ArrowUp, ImagePlus, Square, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { setComposerDraftTarget } from '@/lib/composerDraft';
import { VIDEO_JOINTE_MIME, type ChatAttachmentInput } from '../../../shared/ipc';
import { QUESTION_VIDEO_PAR_DEFAUT } from '@jarvis/core';
import { estVideo, lireVideoPourLesYeux, VIDEO_TYPES } from './yeux/videoYeux';

/** Photo choisie, pas encore envoyée : octets en base64 pour le processus principal, aperçu pour l'écran. */
export interface PendingAttachment extends ChatAttachmentInput {
  id: string;
  previewUrl: string;
  size: number;
}

interface ComposerProps {
  busy: boolean;
  onSend: (text: string, attachments: ChatAttachmentInput[]) => void;
  onCancel: () => void;
}

const MAX_HEIGHT = 140;
const MAX_ATTACHMENTS = 3;
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

export function Composer({ busy, onSend, onCancel }: ComposerProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Les yeux (Jarvis Test) : une vidéo jointe n'est proposée que si les yeux sont allumés.
  const [videoPossible, setVideoPossible] = useState(false);
  const [lectureVideo, setLectureVideo] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

  // 5.0.64 : une carte « à compléter » pose son texte ici, curseur à la fin.
  useEffect(() => {
    setComposerDraftTarget((text) => {
      setValue(text);
      const node = textarea.current;
      if (!node) return;
      node.focus();
      window.requestAnimationFrame(() => node.setSelectionRange(text.length, text.length));
    });
    return () => setComposerDraftTarget(null);
  }, []);

  useEffect(() => {
    let vivant = true;
    void window.jarvis.yeux
      ?.disponible()
      .then((oui: unknown) => {
        if (vivant) setVideoPossible(oui === true);
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const aUneVideo = attachments.some((item) => item.mime === VIDEO_JOINTE_MIME);
  const canSend = !lectureVideo && (value.trim().length > 0 || attachments.length > 0);

  const submit = (): void => {
    if (busy || !canSend) return;
    const text = value.trim() || (aUneVideo ? QUESTION_VIDEO_PAR_DEFAUT : attachments.length ? 'Voici une photo.' : '');
    onSend(
      text,
      attachments.map(({ name, mime, dataBase64, video }) => ({ name, mime, dataBase64, ...(video ? { video } : {}) })),
    );
    setValue('');
    setAttachments([]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files);
    const next: PendingAttachment[] = [];
    for (const file of list) {
      if (estVideo(file)) {
        if (!videoPossible) {
          setNotice('Les vidéos demandent les yeux de Jarvis (Jarvis Test, écran « Yeux »).');
          continue;
        }
        if (attachments.length || next.length || list.length > 1) {
          setNotice('Une vidéo part seule : retire les autres pièces jointes.');
          continue;
        }
        setLectureVideo('Je lis la vidéo…');
        try {
          const lue = await lireVideoPourLesYeux(file, setLectureVideo);
          next.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            mime: VIDEO_JOINTE_MIME,
            dataBase64: lue.apercuBase64,
            video: lue.video,
            previewUrl: `data:image/jpeg;base64,${lue.apercuBase64}`,
            size: file.size,
          });
          setNotice(
            `Vidéo prête : ${lue.video.images.length} images clés${lue.video.audioPcm16Base64 ? ', avec le son' : ', sans son'}${lue.video.tronquee ? ' (3 premières minutes)' : ''}.`,
          );
        } catch (error) {
          setNotice(`Je n’arrive pas à lire « ${file.name} » : ${error instanceof Error ? error.message : String(error)}.`);
        } finally {
          setLectureVideo(null);
        }
        continue;
      }
      if (aUneVideo) {
        setNotice('Une vidéo part seule : retire-la pour joindre une photo.');
        break;
      }
      if (attachments.length + next.length >= MAX_ATTACHMENTS) {
        setNotice(`Au plus ${MAX_ATTACHMENTS} photos par message.`);
        break;
      }
      if (!ACCEPTED.includes(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
        setNotice(`« ${file.name} » n’est pas une image (PNG, JPEG ou WebP).`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setNotice(`« ${file.name} » dépasse 20 Mo.`);
        continue;
      }
      const dataUrl = await readAsDataUrl(file);
      const comma = dataUrl.indexOf(',');
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        mime: file.type || 'image/jpeg',
        dataBase64: dataUrl.slice(comma + 1),
        previewUrl: dataUrl,
        size: file.size,
      });
    }
    if (next.length) setAttachments((current) => [...current, ...next]);
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
    if (event.target.files?.length) void addFiles(event.target.files);
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    if (event.dataTransfer.files?.length) void addFiles(event.dataTransfer.files);
  };

  return (
    <div className="no-drag composer-wrap">
      {attachments.length ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] py-1 pr-1 pl-1 text-xs text-slate-200"
            >
              <img src={attachment.previewUrl} alt="" className="size-9 rounded-md object-cover" />
              <span className="max-w-[160px] truncate">{attachment.mime === VIDEO_JOINTE_MIME ? `🎬 ${attachment.name}` : attachment.name}</span>
              <button
                type="button"
                className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
                onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                title={attachment.mime === VIDEO_JOINTE_MIME ? 'Retirer cette vidéo' : 'Retirer cette photo'}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div
        className={`composer-box${dragging ? ' ring-1 ring-cyan-300/60' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Sparkles className="composer-spark" />
        <textarea
          ref={textarea}
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            aUneVideo
              ? 'Ta question sur la vidéo ? (vide : « résume cette vidéo »)'
              : attachments.length
                ? 'Que faire avec cette photo ? (ex. « fais-en un sticker »)'
                : 'Demande quelque chose à Jarvis…'
          }
        />
        <div className="composer-meta">
          <span>{lectureVideo ?? notice ?? `Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne · glisse une photo${videoPossible ? ' ou une vidéo' : ''} ici`}</span>
          {busy ? <span className="composer-thinking">Jarvis réfléchit…</span> : null}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={`image/png,image/jpeg,image/webp${videoPossible ? `,${VIDEO_TYPES.join(',')}` : ''}`}
          multiple
          hidden
          onChange={onPick}
        />
        <Button
          variant="subtle"
          size="icon"
          onClick={() => fileInput.current?.click()}
          disabled={busy || Boolean(lectureVideo) || aUneVideo || attachments.length >= MAX_ATTACHMENTS}
          title={videoPossible ? 'Joindre une photo ou une vidéo' : 'Joindre une photo (Jarvis s’en servira comme point de départ d’une image)'}
        >
          <ImagePlus className="size-4" />
        </Button>
        {busy ? (
          <Button variant="subtle" size="icon" onClick={onCancel} title="Interrompre">
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button variant="default" size="icon" onClick={submit} disabled={!canSend} title="Envoyer (Entrée)">
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  });
}
