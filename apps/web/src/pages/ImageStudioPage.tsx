import { useEffect, useState, type FormEvent } from 'react';
import {
  imageFormatLabels,
  imageFormatSpecs,
  imageFormats,
  imageStyleLabels,
  imageStyles,
  platformImageFormats,
  socialPlatformLabels,
  socialPlatforms,
  type Brand,
  type DeclineResult,
  type ImageFormat,
  type ImageProject,
  type ImageProjectDetail,
  type ImageStyle,
  type MediaAsset,
  type SocialPlatform,
} from '@ass/shared';
import { api } from '../lib/api';
import { downloadBlob, exportPng as buildPng } from '../lib/png-export';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader } from '../components/ui';

/**
 * AI Image Studio (§7).
 *
 * Le visuel est composé localement : pas de clé d'API, pas de coût, pas de
 * latence réseau. Le SVG produit garde chaque texte sur un calque séparé,
 * donc corrigeable sans régénérer — c'est ce que le cahier des charges
 * demande explicitement.
 */

/** Un SVG rendu en `img` : le document ne peut pas exécuter de script. */
function previewSrc(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface FormState {
  prompt: string;
  title: string;
  brandId: string;
  format: ImageFormat;
  style: ImageStyle;
  platform: '' | SocialPlatform;
  width: string;
  height: string;
  headline: string;
  subheadline: string;
  callToAction: string;
  badge: string;
  palette: string[];
  logoMediaId: string;
  referenceMediaId: string;
}

const initialForm: FormState = {
  prompt: '',
  title: '',
  brandId: '',
  format: 'SQUARE',
  style: 'EDITORIAL',
  platform: '',
  width: '1080',
  height: '1080',
  headline: '',
  subheadline: '',
  callToAction: '',
  badge: '',
  palette: [],
  logoMediaId: '',
  referenceMediaId: '',
};

interface Draft {
  headline: string;
  subheadline: string;
  callToAction: string;
  badge: string;
}

const emptyDraft: Draft = { headline: '', subheadline: '', callToAction: '', badge: '' };

export function ImageStudioPage() {
  const [projects, setProjects] = useState<ImageProject[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [brands, setBrands] = useState<Brand[]>([]);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [selected, setSelected] = useState<ImageProjectDetail | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [form, setForm] = useState<FormState>(initialForm);
  const [declineFormats, setDeclineFormats] = useState<ImageFormat[]>([]);
  const [declineResult, setDeclineResult] = useState<DeclineResult | null>(null);
  const [declining, setDeclining] = useState(false);
  const [pngBusy, setPngBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const refresh = () => setReload((n) => n + 1);
  const patch = (values: Partial<FormState>) => setForm((prev) => ({ ...prev, ...values }));

  useEffect(() => {
    let active = true;
    Promise.all([api.image.list(), api.brands.list(), api.media.list()])
      .then(([list, brandList, mediaList]) => {
        if (!active) return;
        setProjects(list);
        setBrands(brandList);
        setMedia(mediaList);
        // Vignettes : les six visuels les plus récents suffisent à donner
        // une vue d'ensemble sans multiplier les requêtes.
        return Promise.all(
          list.slice(0, 6).map((project) =>
            api.image
              .detail(project.id)
              .then((detail) => [project.id, detail.svg] as const)
              .catch(() => null),
          ),
        ).then((entries) => {
          if (!active) return;
          const next: Record<string, string> = {};
          for (const entry of entries) {
            if (entry) next[entry[0]] = entry[1];
          }
          setThumbs(next);
        });
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Erreur de chargement');
      });
    return () => {
      active = false;
    };
  }, [reload]);

  function open(detail: ImageProjectDetail) {
    setSelected(detail);
    setDraft({
      headline: detail.headline ?? '',
      subheadline: detail.subheadline ?? '',
      callToAction: detail.callToAction ?? '',
      badge: detail.badge ?? '',
    });
    setDeclineFormats([]);
    setDeclineResult(null);
    setNotice('');
    setError('');
  }

  async function select(id: string) {
    setError('');
    try {
      open(await api.image.detail(id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Visuel introuvable');
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const custom = form.format === 'CUSTOM';
      const detail = await api.image.create({
        prompt: form.prompt,
        format: form.format,
        style: form.style,
        ...(form.palette.length > 0 ? { palette: form.palette } : {}),
        ...(form.title ? { title: form.title } : {}),
        ...(form.brandId ? { brandId: form.brandId } : {}),
        ...(form.platform ? { platform: form.platform } : {}),
        ...(custom ? { width: Number(form.width), height: Number(form.height) } : {}),
        ...(form.headline ? { headline: form.headline } : {}),
        ...(form.subheadline ? { subheadline: form.subheadline } : {}),
        ...(form.callToAction ? { callToAction: form.callToAction } : {}),
        ...(form.badge ? { badge: form.badge } : {}),
        ...(form.logoMediaId ? { logoMediaId: form.logoMediaId } : {}),
        ...(form.referenceMediaId ? { referenceMediaIds: [form.referenceMediaId] } : {}),
      });
      open(detail);
      setForm((prev) => ({ ...initialForm, format: prev.format, style: prev.style }));
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Génération impossible');
    } finally {
      setBusy(false);
    }
  }

  async function saveTexts() {
    if (!selected) return;
    setError('');
    setBusy(true);
    try {
      open(
        await api.image.update(selected.id, {
          headline: draft.headline.trim() || null,
          subheadline: draft.subheadline.trim() || null,
          callToAction: draft.callToAction.trim() || null,
          badge: draft.badge.trim() || null,
        }),
      );
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Correction impossible');
    } finally {
      setBusy(false);
    }
  }

  async function rerender() {
    if (!selected) return;
    setError('');
    setBusy(true);
    try {
      open(await api.image.rerender(selected.id));
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Régénération impossible');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await api.image.remove(id);
      if (selected?.id === id) {
        setSelected(null);
        setDraft(emptyDraft);
      }
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Suppression impossible');
    }
  }

  function toggleDecline(format: ImageFormat) {
    setDeclineFormats((prev) =>
      prev.includes(format) ? prev.filter((value) => value !== format) : [...prev, format],
    );
  }

  /** Export PNG : intégration des ressources externes puis rendu canvas. */
  async function exportPng(scale: number) {
    if (!selected) return;
    setError('');
    setNotice('');
    setPngBusy(true);
    try {
      const result = await buildPng({
        svg: selected.svg,
        width: selected.width,
        height: selected.height,
        filename: `visuel-${selected.format.toLowerCase()}-${selected.id}`,
        scale,
      });
      downloadBlob(result.blob, result.filename);
      setNotice(
        result.warnings.length > 0
          ? `PNG exporté (${result.filename}) — ${result.warnings.join(' ; ')}`
          : `PNG exporté : ${result.filename} (${selected.width * scale}×${selected.height * scale})`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Export PNG impossible');
    } finally {
      setPngBusy(false);
    }
  }

  async function decline() {
    if (!selected || declineFormats.length === 0) return;
    setError('');
    setNotice('');
    setDeclining(true);
    try {
      const result = await api.image.decline(selected.id, declineFormats);
      setDeclineResult(result);
      setDeclineFormats([]);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Déclinaison impossible');
    } finally {
      setDeclining(false);
    }
  }

  const images = media.filter((asset) => asset.kind === 'IMAGE');
  const allowedFormats = form.platform ? platformImageFormats[form.platform] : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Image Studio"
        description="Composez un visuel à partir d'un brief : format, style, palette et textes restent modifiables après génération."
      />
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="mb-4 font-medium">Brief</h2>
          <form onSubmit={create} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">Que doit montrer le visuel ?</span>
              <textarea
                required
                minLength={10}
                rows={3}
                value={form.prompt}
                onChange={(event) => patch({ prompt: event.target.value })}
                placeholder="Ex. Annoncer l'ouverture de l'atelier avec un ton posé et une composition épurée."
                className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <span className="block text-xs text-text-muted">
                Le titre est déduit du brief, puis librement corrigeable.
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Format</span>
                <select
                  value={form.format}
                  onChange={(event) => patch({ format: event.target.value as ImageFormat })}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {imageFormats.map((format) => {
                    const blocked = allowedFormats !== null && !allowedFormats.includes(format);
                    return (
                      <option key={format} value={format} disabled={blocked}>
                        {imageFormatLabels[format]}
                        {blocked ? ' — incompatible' : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Style</span>
                <select
                  value={form.style}
                  onChange={(event) => patch({ style: event.target.value as ImageStyle })}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {imageStyles.map((style) => (
                    <option key={style} value={style}>
                      {imageStyleLabels[style]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {form.format === 'CUSTOM' && (
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Largeur (px)"
                  type="number"
                  min={256}
                  max={4096}
                  value={form.width}
                  onChange={(event) => patch({ width: event.target.value })}
                />
                <Field
                  label="Hauteur (px)"
                  type="number"
                  min={256}
                  max={4096}
                  value={form.height}
                  onChange={(event) => patch({ height: event.target.value })}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Marque</span>
                <select
                  value={form.brandId}
                  onChange={(event) => patch({ brandId: event.target.value })}
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
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Plateforme visée</span>
                <select
                  value={form.platform}
                  onChange={(event) =>
                    patch({ platform: event.target.value as '' | SocialPlatform })
                  }
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  <option value="">Non précisée</option>
                  {socialPlatforms.map((platform) => (
                    <option key={platform} value={platform}>
                      {socialPlatformLabels[platform]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Palette</legend>
              <p className="text-xs text-text-muted">
                La première couleur sert de fond, la deuxième d'accent.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {form.palette.map((color, index) => (
                  <span key={`${color}-${index}`} className="flex items-center gap-1">
                    <input
                      type="color"
                      value={color}
                      onChange={(event) => {
                        const next = [...form.palette];
                        next[index] = event.target.value;
                        patch({ palette: next });
                      }}
                      aria-label={`Couleur ${index + 1}`}
                      className="h-8 w-10 rounded border border-border bg-bg"
                    />
                    <button
                      type="button"
                      onClick={() => patch({ palette: form.palette.filter((_, i) => i !== index) })}
                      className="text-xs text-text-muted hover:text-danger"
                    >
                      retirer
                    </button>
                  </span>
                ))}
                {form.palette.length < 8 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => patch({ palette: [...form.palette, '#7c5cff'] })}
                  >
                    Ajouter une couleur
                  </Button>
                )}
                {form.palette.length > 0 && (
                  <Button type="button" variant="ghost" onClick={() => patch({ palette: [] })}>
                    Réinitialiser
                  </Button>
                )}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Logo</span>
                <select
                  value={form.logoMediaId}
                  onChange={(event) => patch({ logoMediaId: event.target.value })}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  <option value="">Logo de la marque</option>
                  {images.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Image de référence</span>
                <select
                  value={form.referenceMediaId}
                  onChange={(event) => patch({ referenceMediaId: event.target.value })}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  <option value="">Aucune</option>
                  {images.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <details className="rounded-lg border border-border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                Forcer les textes (facultatif)
              </summary>
              <div className="mt-3 grid gap-3">
                <Field
                  label="Titre"
                  maxLength={120}
                  value={form.headline}
                  onChange={(event) => patch({ headline: event.target.value })}
                  placeholder="Déduit du brief si vide"
                />
                <Field
                  label="Sous-titre"
                  maxLength={200}
                  value={form.subheadline}
                  onChange={(event) => patch({ subheadline: event.target.value })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Bouton"
                    maxLength={40}
                    value={form.callToAction}
                    onChange={(event) => patch({ callToAction: event.target.value })}
                  />
                  <Field
                    label="Pastille"
                    maxLength={30}
                    value={form.badge}
                    onChange={(event) => patch({ badge: event.target.value })}
                  />
                </div>
              </div>
            </details>

            <Field
              label="Nom interne (facultatif)"
              maxLength={160}
              value={form.title}
              onChange={(event) => patch({ title: event.target.value })}
              placeholder="Ex. Annonce ouverture"
            />

            <Button type="submit" disabled={busy || form.prompt.trim().length < 10}>
              {busy ? 'Composition…' : 'Générer le visuel'}
            </Button>
          </form>
        </Card>

        <Card>
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="font-medium">Aperçu</h2>
            {selected && (
              <span className="text-xs text-text-muted">
                {selected.width}×{selected.height} · graine {selected.seed}
              </span>
            )}
          </div>

          {selected === null ? (
            <Empty>Générez un visuel ou sélectionnez-en un dans la galerie.</Empty>
          ) : (
            <div className="space-y-4">
              <img
                src={previewSrc(selected.svg)}
                alt={selected.headline ?? selected.prompt}
                width={selected.width}
                height={selected.height}
                className="w-full rounded-lg border border-border bg-bg"
              />

              {selected.warnings.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
                  {selected.warnings.map((warning) => (
                    <li key={warning}>· {warning}</li>
                  ))}
                </ul>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Titre"
                  maxLength={120}
                  value={draft.headline}
                  onChange={(event) => setDraft({ ...draft, headline: event.target.value })}
                />
                <Field
                  label="Sous-titre"
                  maxLength={200}
                  value={draft.subheadline}
                  onChange={(event) => setDraft({ ...draft, subheadline: event.target.value })}
                />
                <Field
                  label="Bouton"
                  maxLength={40}
                  value={draft.callToAction}
                  onChange={(event) => setDraft({ ...draft, callToAction: event.target.value })}
                />
                <Field
                  label="Pastille"
                  maxLength={30}
                  value={draft.badge}
                  onChange={(event) => setDraft({ ...draft, badge: event.target.value })}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void saveTexts()} disabled={busy}>
                  Corriger les textes
                </Button>
                <Button variant="ghost" onClick={() => void rerender()} disabled={busy}>
                  Nouveau décor
                </Button>
                <Button variant="ghost" onClick={() => void exportPng(1)} disabled={pngBusy}>
                  {pngBusy ? 'Export…' : 'PNG'}
                </Button>
                <Button variant="ghost" onClick={() => void exportPng(2)} disabled={pngBusy}>
                  PNG ×2
                </Button>
                <a
                  href={api.image.downloadUrl(selected.id)}
                  className="inline-flex items-center rounded-lg border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent"
                  download={`visuel-${selected.id}.svg`}
                >
                  Télécharger le SVG
                </a>
                <Button variant="danger" onClick={() => void remove(selected.id)} disabled={busy}>
                  Supprimer
                </Button>
              </div>

              {notice && (
                <p
                  role="status"
                  className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent"
                >
                  {notice}
                </p>
              )}

              <fieldset className="space-y-2 rounded-lg border border-border px-3 py-3">
                <legend className="px-1 text-sm font-medium">Décliner dans d'autres formats</legend>
                <p className="text-xs text-text-muted">
                  Mêmes textes, même palette, même graine : seul le gabarit change et la typographie
                  se réajuste.
                </p>
                <div className="flex flex-wrap gap-3">
                  {imageFormats
                    .filter((format) => format !== selected.format && format !== 'CUSTOM')
                    .map((format) => (
                      <label key={format} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={declineFormats.includes(format)}
                          onChange={() => toggleDecline(format)}
                        />
                        <span>{imageFormatLabels[format]}</span>
                      </label>
                    ))}
                </div>
                <Button
                  onClick={() => void decline()}
                  disabled={declining || declineFormats.length === 0}
                >
                  {declining ? 'Déclinaison…' : 'Décliner'}
                </Button>
                {declineResult && (
                  <div className="space-y-1 text-xs text-text-muted">
                    {declineResult.created.length > 0 && (
                      <p className="text-accent">
                        {declineResult.created.length} visuel
                        {declineResult.created.length > 1 ? 's' : ''} créé
                        {declineResult.created.length > 1 ? 's' : ''}.
                      </p>
                    )}
                    {declineResult.skipped.map((item) => (
                      <p key={item.format}>
                        · {imageFormatLabels[item.format]} ignoré — {item.reason}
                      </p>
                    ))}
                  </div>
                )}
              </fieldset>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-text-muted">
                <div>
                  <dt className="inline">Format : </dt>
                  <dd className="inline">{imageFormatLabels[selected.format]}</dd>
                </div>
                <div>
                  <dt className="inline">Style : </dt>
                  <dd className="inline">{imageStyleLabels[selected.style]}</dd>
                </div>
                <div>
                  <dt className="inline">Moteur : </dt>
                  <dd className="inline">
                    {selected.provider} · {selected.model}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Palette : </dt>
                  <dd className="inline">{selected.palette.join(' ')}</dd>
                </div>
              </dl>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 font-medium">Galerie</h2>
        {projects.length === 0 ? (
          <Empty>Aucun visuel pour cette organisation.</Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const thumb = thumbs[project.id];
              return (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => void select(project.id)}
                    className={`block w-full rounded-lg border p-2 text-left transition-colors ${
                      selected?.id === project.id
                        ? 'border-accent'
                        : 'border-border hover:border-accent'
                    }`}
                  >
                    {thumb ? (
                      <img
                        src={previewSrc(thumb)}
                        alt={project.headline ?? project.prompt}
                        className="mb-2 w-full rounded border border-border bg-bg"
                      />
                    ) : (
                      <span className="mb-2 flex h-24 items-center justify-center rounded border border-border text-xs text-text-muted">
                        {imageFormatLabels[project.format]}
                      </span>
                    )}
                    <span className="block truncate text-sm font-medium">
                      {project.title ?? project.headline ?? project.prompt}
                    </span>
                    <span className="block text-xs text-text-muted">
                      {imageFormatLabels[project.format]} · {project.width}×{project.height} ·{' '}
                      {formatDate(project.createdAt)}
                      {project.sourceProjectId ? ' · déclinaison' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-xs text-text-muted">
        Formats disponibles :{' '}
        {Object.entries(imageFormatSpecs)
          .map(([, spec]) => `${spec.label} ${spec.width}×${spec.height}`)
          .join(' · ')}
        . Un moteur raster pourra être branché derrière la même interface sans changer les contrats
        d'API.
      </p>
    </div>
  );
}
