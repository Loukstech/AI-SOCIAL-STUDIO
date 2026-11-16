import { useEffect, useState, type FormEvent } from 'react';
import type {
  Brand,
  RenderFormat,
  SubtitleFormat,
  SubtitleStyle,
  TranscriptSegment,
  VideoProject,
  VideoProjectDetail,
  VideoProjectStatus,
  VideoRenderResult,
} from '@ass/shared';
import {
  clipTargetDurations,
  renderFormats,
  subtitleStyleLabels,
  subtitleStyles,
} from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader } from '../components/ui';

const PROJECT_STATUS: Record<VideoProjectStatus, { label: string; tone: string }> = {
  DRAFT: { label: 'Brouillon', tone: 'text-text-muted' },
  TRANSCRIBING: { label: 'Transcription…', tone: 'text-accent' },
  TRANSCRIBED: { label: 'Transcrit', tone: 'text-success' },
  FAILED: { label: 'Échec', tone: 'text-danger' },
};

const EXPORT_FORMATS: { id: SubtitleFormat; label: string }[] = [
  { id: 'srt', label: 'SRT' },
  { id: 'vtt', label: 'VTT' },
  { id: 'txt', label: 'TXT' },
];

function formatSeconds(value: number): string {
  const total = Math.max(0, value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function scoreTone(score: number): string {
  if (score >= 75) return 'border-success/40 text-success';
  if (score >= 55) return 'border-accent/40 text-accent';
  return 'border-border text-text-muted';
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function VideoStudioPage() {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [detail, setDetail] = useState<VideoProjectDetail | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [brandId, setBrandId] = useState('');
  const [style, setStyle] = useState<SubtitleStyle>('PROFESSIONAL');
  const [targetDuration, setTargetDuration] = useState<number>(30);
  const [draft, setDraft] = useState<TranscriptSegment[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [renderSourcePath, setRenderSourcePath] = useState('');
  const [renderFormat, setRenderFormat] = useState<RenderFormat>('PORTRAIT');
  const [renderSubtitleTrackId, setRenderSubtitleTrackId] = useState('');
  const [renderResult, setRenderResult] = useState<VideoRenderResult | null>(null);

  const refresh = () => setReload((n) => n + 1);

  useEffect(() => {
    let active = true;
    Promise.all([api.videoProjects.list(), api.brands.list()])
      .then(([projectList, brandList]) => {
        if (!active) return;
        setProjects(projectList);
        setBrands(brandList);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Erreur de chargement');
      });
    return () => {
      active = false;
    };
  }, [reload]);

  async function run<T>(action: () => Promise<T>, failure: string): Promise<T | null> {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      return await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    const loaded = await run(() => api.videoProjects.detail(id), 'Projet introuvable');
    if (loaded) {
      setDetail(loaded);
      setDraft(null);
      setRenderResult(null);
      setRenderSubtitleTrackId('');
    }
  }

  async function reloadDetail(id: string) {
    const loaded = await api.videoProjects.detail(id).catch(() => null);
    if (loaded) setDetail(loaded);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const created = await run(
      () =>
        api.videoProjects.create({
          name,
          ...(description ? { description } : {}),
          ...(sourceUrl ? { sourceUrl } : {}),
          ...(brandId ? { brandId } : {}),
        }),
      'Création impossible',
    );
    if (!created) return;
    setName('');
    setDescription('');
    setSourceUrl('');
    setBrandId('');
    refresh();
    await open(created.id);
  }

  async function transcribe() {
    if (!detail) return;
    const updated = await run(
      () => api.videoProjects.transcribe(detail.id),
      'Transcription impossible',
    );
    if (!updated) return;
    setDetail(updated);
    setDraft(null);
    refresh();
  }

  async function generateSubtitles() {
    if (!detail) return;
    const track = await run(
      () => api.videoProjects.subtitles(detail.id, style),
      'Génération impossible',
    );
    if (!track) return;
    await reloadDetail(detail.id);
    refresh();
    setNotice(`Piste « ${subtitleStyleLabels[track.style]} » prête : ${track.cueCount} cue(s).`);
  }

  async function saveTranscript() {
    if (!detail || !draft) return;
    const updated = await run(
      () => api.videoProjects.updateTranscript(detail.id, { segments: draft }),
      'Enregistrement impossible',
    );
    if (!updated) return;
    setDetail(updated);
    setDraft(null);
    refresh();
    setNotice('Transcription enregistrée. Régénérez les sous-titres pour la refléter.');
  }

  async function extractClips() {
    if (!detail) return;
    const clips = await run(
      () => api.videoProjects.suggestClips(detail.id, targetDuration),
      'Extraction impossible',
    );
    if (!clips) return;
    setDetail({ ...detail, clips });
    setNotice(`${clips.length} clip(s) proposé(s) pour une cible de ${targetDuration} s.`);
  }

  async function renderVideo() {
    if (!detail) return;
    if (!renderSourcePath && !detail.sourceUrl?.startsWith('file:')) {
      setError('Renseignez un fichier source local ou une URL file:// sur le projet.');
      return;
    }
    const retained = detail.clips.filter((clip) => clip.selected);
    const clips = retained.length
      ? retained.map((clip) => ({ start: clip.start, end: clip.end, label: clip.title }))
      : [
          {
            start: 0,
            end: detail.durationSeconds ?? 30,
            label: 'Vidéo complète',
          },
        ];
    const result = await run(
      () =>
        api.videoProjects.render(detail.id, {
          clips,
          format: renderFormat,
          ...(renderSourcePath ? { sourcePath: renderSourcePath } : {}),
          ...(renderSubtitleTrackId ? { subtitleTrackId: renderSubtitleTrackId } : {}),
        }),
      'Rendu impossible',
    );
    if (!result) return;
    setRenderResult(result);
    setNotice(
      `Rendu terminé : ${result.clips} clip(s) au format ${result.format}. Fichier : ${result.outputPath}`,
    );
  }

  async function toggleClip(clipId: string, selected: boolean) {
    if (!detail) return;
    const updated = await run(
      () => api.videoProjects.updateClip(detail.id, clipId, { selected }),
      'Mise à jour impossible',
    );
    if (!updated) return;
    setDetail({
      ...detail,
      clips: detail.clips.map((clip) => (clip.id === clipId ? updated : clip)),
    });
  }

  async function removeClip(clipId: string) {
    if (!detail) return;
    const done = await run(
      () => api.videoProjects.removeClip(detail.id, clipId),
      'Suppression impossible',
    );
    if (done === null) return;
    setDetail({ ...detail, clips: detail.clips.filter((clip) => clip.id !== clipId) });
  }

  async function exportTrack(trackId: string, format: SubtitleFormat) {
    if (!detail) return;
    const exported = await run(
      () => api.videoProjects.exportSubtitle(detail.id, trackId, format),
      'Export impossible',
    );
    if (exported) downloadText(exported.filename, exported.content);
  }

  async function copyTrack(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setNotice('SRT copié dans le presse-papiers.');
    } catch {
      setError('Copie impossible : sélectionnez le texte manuellement.');
    }
  }

  async function remove(id: string) {
    const done = await run(() => api.videoProjects.remove(id), 'Suppression impossible');
    if (done === null) return;
    if (detail?.id === id) setDetail(null);
    setDraft(null);
    refresh();
  }

  function updateSegment(index: number, patch: Partial<TranscriptSegment>) {
    if (!draft) return;
    setDraft(
      draft.map((segment, position) => (position === index ? { ...segment, ...patch } : segment)),
    );
  }

  const segments = draft ?? detail?.transcript?.segments ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Video Studio"
        description="Transcription éditable, sept styles de sous-titres, exports SRT / VTT / TXT et extraction des meilleurs passages. Le rendu ffmpeg arrivera avec le worker dédié."
      />
      {error && <Alert>{error}</Alert>}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent"
        >
          {notice}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card>
            <h2 className="mb-4 font-medium">Nouveau projet</h2>
            <form onSubmit={create} className="space-y-3">
              <Field
                label="Nom"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex. Lancement collection"
              />
              <Field
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Angle, message principal…"
              />
              <Field
                label="URL de la source (facultatif)"
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://…"
              />
              {brands.length > 0 && (
                <label className="block space-y-1.5">
                  <span className="block text-sm font-medium">Marque</span>
                  <select
                    value={brandId}
                    onChange={(e) => setBrandId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                  >
                    <option value="">Aucune</option>
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button type="submit" disabled={busy || name.trim().length < 2}>
                {busy ? 'Création…' : 'Créer le projet'}
              </Button>
            </form>
          </Card>

          <Card>
            <h2 className="mb-3 font-medium">Projets</h2>
            {projects.length === 0 ? (
              <Empty>Aucun projet vidéo.</Empty>
            ) : (
              <ul className="space-y-1">
                {projects.map((project) => (
                  <li key={project.id}>
                    <button
                      type="button"
                      onClick={() => void open(project.id)}
                      className={`w-full rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                        detail?.id === project.id
                          ? 'bg-accent/12 text-accent'
                          : 'hover:bg-bg text-text-muted hover:text-text'
                      }`}
                    >
                      <span className="block truncate font-medium">{project.name}</span>
                      <span className="block text-xs">
                        {PROJECT_STATUS[project.status].label} · {project.subtitleCount} piste(s)
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          {!detail ? (
            <Empty>
              Sélectionnez un projet pour voir sa transcription, ses clips et ses sous-titres.
            </Empty>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{detail.name}</h2>
                  <p className="text-xs text-text-muted">
                    {brands.find((brand) => brand.id === detail.brandId)?.name ?? 'Sans marque'} ·
                    créé le {formatDate(detail.createdAt)}
                    {detail.durationSeconds ? ` · ${detail.durationSeconds} s` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-medium ${PROJECT_STATUS[detail.status].tone}`}>
                    {PROJECT_STATUS[detail.status].label}
                  </span>
                  <Button variant="danger" onClick={() => void remove(detail.id)}>
                    Supprimer
                  </Button>
                </div>
              </div>

              {detail.description && (
                <p className="text-sm text-text-muted">{detail.description}</p>
              )}

              <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                <Button onClick={() => void transcribe()} disabled={busy}>
                  {detail.transcript ? 'Retranscrire' : 'Transcrire'}
                </Button>
                <label className="block space-y-1.5">
                  <span className="block text-sm font-medium">Style de sous-titres</span>
                  <select
                    value={style}
                    onChange={(e) => setStyle(e.target.value as SubtitleStyle)}
                    className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                  >
                    {subtitleStyles.map((value) => (
                      <option key={value} value={value}>
                        {subtitleStyleLabels[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="ghost"
                  onClick={() => void generateSubtitles()}
                  disabled={busy || !detail.transcript}
                >
                  Générer les sous-titres
                </Button>
              </div>

              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">Transcription</h3>
                  {detail.transcript && (
                    <div className="flex gap-2">
                      {draft ? (
                        <>
                          <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                            Annuler
                          </Button>
                          <Button onClick={() => void saveTranscript()} disabled={busy}>
                            {busy ? 'Enregistrement…' : 'Enregistrer'}
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setDraft(
                              (detail.transcript?.segments ?? []).map((segment) => ({
                                ...segment,
                              })),
                            )
                          }
                        >
                          Modifier
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {!detail.transcript ? (
                  <Empty>Aucune transcription. Lancez « Transcrire » pour en générer une.</Empty>
                ) : draft ? (
                  <div className="space-y-2">
                    {draft.map((segment, index) => (
                      <div
                        key={`edit-${index}`}
                        className="grid gap-2 rounded-lg border border-border bg-bg p-2 sm:grid-cols-[80px_80px_1fr]"
                      >
                        <label className="block">
                          <span className="block text-xs text-text-muted">Début (s)</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={segment.start}
                            onChange={(e) =>
                              updateSegment(index, { start: Number(e.target.value) })
                            }
                            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
                          />
                        </label>
                        <label className="block">
                          <span className="block text-xs text-text-muted">Fin (s)</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={segment.end}
                            onChange={(e) => updateSegment(index, { end: Number(e.target.value) })}
                            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
                          />
                        </label>
                        <label className="block">
                          <span className="block text-xs text-text-muted">Texte</span>
                          <input
                            value={segment.text}
                            onChange={(e) => updateSegment(index, { text: e.target.value })}
                            className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
                          />
                        </label>
                      </div>
                    ))}
                    <p className="text-xs text-text-muted">
                      Enregistrer supprime les pistes existantes : elles sont recalculées à partir
                      du nouveau texte.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-text-muted">
                      Fournisseur : {detail.transcript.provider ?? 'inconnu'} · {segments.length}{' '}
                      segment(s) · {detail.transcript.status}
                    </p>
                    <ol className="space-y-1 rounded-lg border border-border bg-bg p-3 text-sm">
                      {segments.map((segment, index) => (
                        <li key={`read-${index}`} className="flex gap-3">
                          <span className="shrink-0 font-mono text-xs text-text-muted">
                            {segment.start.toFixed(1)}s
                          </span>
                          <span>{segment.text}</span>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </section>

              <section className="space-y-3 border-t border-border pt-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">Meilleurs passages</h3>
                    <p className="text-xs text-text-muted">
                      Mode A — l'analyse classe les passages autonomes de la transcription.
                    </p>
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="block space-y-1.5">
                      <span className="block text-xs text-text-muted">Durée cible</span>
                      <select
                        value={targetDuration}
                        onChange={(e) => setTargetDuration(Number(e.target.value))}
                        className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                      >
                        {clipTargetDurations.map((value) => (
                          <option key={value} value={value}>
                            {value} s
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      variant="ghost"
                      onClick={() => void extractClips()}
                      disabled={busy || !detail.transcript}
                    >
                      Proposer des clips
                    </Button>
                  </div>
                </div>

                {detail.clips.length === 0 ? (
                  <Empty>Aucun clip proposé pour l'instant.</Empty>
                ) : (
                  <ul className="space-y-2">
                    {detail.clips.map((clip) => (
                      <li
                        key={clip.id}
                        className={`rounded-lg border p-3 ${
                          clip.selected ? 'border-accent/60 bg-accent/5' : 'border-border'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{clip.title}</p>
                            <p className="font-mono text-xs text-text-muted">
                              {formatSeconds(clip.start)} → {formatSeconds(clip.end)} ·{' '}
                              {clip.duration.toFixed(1)} s
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums ${scoreTone(clip.score)}`}
                            >
                              {clip.score}/100
                            </span>
                            <Button
                              variant="ghost"
                              onClick={() => void toggleClip(clip.id, !clip.selected)}
                              disabled={busy}
                            >
                              {clip.selected ? 'Retenu ✓' : 'Retenir'}
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => void removeClip(clip.id)}
                              disabled={busy}
                            >
                              Retirer
                            </Button>
                          </div>
                        </div>
                        <p className="mt-2 text-sm text-text-muted">{clip.summary}</p>
                        <p className="mt-1 text-xs italic text-text-muted">{clip.rationale}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2 border-t border-border pt-4">
                <h3 className="text-sm font-medium">Pistes de sous-titres</h3>
                {detail.subtitles.length === 0 ? (
                  <Empty>Aucune piste générée.</Empty>
                ) : (
                  <ul className="space-y-3">
                    {detail.subtitles.map((track) => (
                      <li key={track.id} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            {subtitleStyleLabels[track.style]} · {track.language} · {track.cueCount}{' '}
                            cue(s)
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="ghost" onClick={() => void copyTrack(track.content)}>
                              Copier le SRT
                            </Button>
                            {EXPORT_FORMATS.map((format) => (
                              <Button
                                key={format.id}
                                variant="ghost"
                                onClick={() => void exportTrack(track.id, format.id)}
                                disabled={busy}
                              >
                                {format.label}
                              </Button>
                            ))}
                          </div>
                        </div>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-text-muted">
                            Aperçu du fichier SRT
                          </summary>
                          <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-bg p-2 text-xs">
                            {track.content}
                          </pre>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-3 border-t border-border pt-4">
                <div>
                  <h3 className="text-sm font-medium">Rendu vidéo (ffmpeg)</h3>
                  <p className="text-xs text-text-muted">
                    Les passages retenus sont assemblés par le worker local. Une URL distante sans
                    fichier local est refusée : aucun téléchargement n'est effectué.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field
                    label="Fichier source local"
                    value={renderSourcePath}
                    placeholder="C:\\video\\source.mp4"
                    hint="Vide = URL file:// du projet"
                    onChange={(event) => setRenderSourcePath(event.target.value)}
                  />
                  <label className="block space-y-1.5">
                    <span className="block text-sm font-medium">Format</span>
                    <select
                      value={renderFormat}
                      onChange={(event) => setRenderFormat(event.target.value as RenderFormat)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                    >
                      {renderFormats.map((format) => (
                        <option key={format} value={format}>
                          {format}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="block text-sm font-medium">Sous-titres à incruster</span>
                    <select
                      value={renderSubtitleTrackId}
                      onChange={(event) => setRenderSubtitleTrackId(event.target.value)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                    >
                      <option value="">Aucun</option>
                      {detail.subtitles.map((track) => (
                        <option key={track.id} value={track.id}>
                          {subtitleStyleLabels[track.style]} · {track.language}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => void renderVideo()}
                    disabled={busy || (!renderSourcePath && !detail.sourceUrl?.startsWith('file:'))}
                  >
                    Rendre la vidéo
                  </Button>
                  <span className="text-xs text-text-muted">
                    {detail.clips.filter((clip) => clip.selected).length} clip(s) retenu(s)
                    {detail.clips.every((clip) => !clip.selected) && ' · vidéo complète'}
                  </span>
                </div>
                {renderResult && (
                  <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
                    Fichier produit : {renderResult.outputPath} · {renderResult.clips} clip(s) ·
                    sous-titres {renderResult.subtitlesApplied ? 'inclus' : 'absents'}
                  </p>
                )}
              </section>

              <p className="border-t border-border pt-3 text-xs text-text-muted">
                Mode démonstration : la transcription est générée localement (AI_PROVIDER=mock). Le
                rendu vidéo est assuré par le worker ffmpeg branché à l'API ; ffmpeg doit être
                disponible sur la machine qui exécute l'API.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
