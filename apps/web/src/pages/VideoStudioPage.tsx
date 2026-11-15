import { useEffect, useState, type FormEvent } from 'react';
import type {
  Brand,
  SubtitleStyle,
  VideoProject,
  VideoProjectDetail,
  VideoProjectStatus,
} from '@ass/shared';
import { subtitleStyleLabels, subtitleStyles } from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader } from '../components/ui';

const PROJECT_STATUS: Record<VideoProjectStatus, { label: string; tone: string }> = {
  DRAFT: { label: 'Brouillon', tone: 'text-text-muted' },
  TRANSCRIBING: { label: 'Transcription…', tone: 'text-accent' },
  TRANSCRIBED: { label: 'Transcrit', tone: 'text-success' },
  FAILED: { label: 'Échec', tone: 'text-danger' },
};

export function VideoStudioPage() {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [detail, setDetail] = useState<VideoProjectDetail | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [brandId, setBrandId] = useState('');
  const [style, setStyle] = useState<SubtitleStyle>('PROFESSIONAL');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState('');
  const [reload, setReload] = useState(0);

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

  async function open(id: string) {
    setError('');
    try {
      setDetail(await api.videoProjects.detail(id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Projet introuvable');
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const created = await api.videoProjects.create({
        name,
        ...(description ? { description } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(brandId ? { brandId } : {}),
      });
      setName('');
      setDescription('');
      setSourceUrl('');
      setBrandId('');
      refresh();
      await open(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Création impossible');
    } finally {
      setBusy(false);
    }
  }

  async function transcribe() {
    if (!detail) return;
    setError('');
    setBusy(true);
    try {
      setDetail(await api.videoProjects.transcribe(detail.id));
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Transcription impossible');
    } finally {
      setBusy(false);
    }
  }

  async function generateSubtitles() {
    if (!detail) return;
    setError('');
    setBusy(true);
    try {
      await api.videoProjects.subtitles(detail.id, style);
      setDetail(await api.videoProjects.detail(detail.id));
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Génération impossible');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await api.videoProjects.remove(id);
      if (detail?.id === id) setDetail(null);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Suppression impossible');
    }
  }

  async function copyTrack(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
    } catch {
      setError('Copie impossible : sélectionnez le texte manuellement.');
    }
  }

  function downloadTrack(name: string, style: SubtitleStyle, content: string) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/[^\w-]+/g, '-').toLowerCase()}.${style.toLowerCase()}.srt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Video Studio"
        description="Préparez un projet vidéo, générez sa transcription et ses sous-titres. Le rendu ffmpeg arrivera avec le worker dédié."
      />
      {error && <Alert>{error}</Alert>}

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
            <Empty>Sélectionnez un projet pour voir sa transcription et ses sous-titres.</Empty>
          ) : (
            <div className="space-y-5">
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

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Transcription</h3>
                {!detail.transcript ? (
                  <Empty>Aucune transcription. Lancez « Transcrire » pour en générer une.</Empty>
                ) : (
                  <>
                    <p className="text-xs text-text-muted">
                      Fournisseur : {detail.transcript.provider ?? 'inconnu'} ·{' '}
                      {detail.transcript.segments.length} segment(s) · {detail.transcript.status}
                    </p>
                    <ol className="space-y-1 rounded-lg border border-border bg-bg p-3 text-sm">
                      {detail.transcript.segments.map((segment, index) => (
                        <li key={`${segment.start}-${index}`} className="flex gap-3">
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

              <section className="space-y-2">
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
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              onClick={() => void copyTrack(track.id, track.content)}
                            >
                              {copiedId === track.id ? 'Copié' : 'Copier le SRT'}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => downloadTrack(detail.name, track.style, track.content)}
                            >
                              Télécharger
                            </Button>
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

              <p className="border-t border-border pt-3 text-xs text-text-muted">
                Mode démonstration : la transcription est générée localement (AI_PROVIDER=mock).
                Brancher OpenAI ou un autre fournisseur se fait côté API, sans changer cette
                interface.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
