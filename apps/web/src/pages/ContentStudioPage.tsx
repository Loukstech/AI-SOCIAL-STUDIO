import { useEffect, useState, type FormEvent } from 'react';
import type {
  Brand,
  ContentLanguage,
  ContentProject,
  ContentProjectDetail,
  ContentTone,
  ContentType,
  ContentVariant,
  RewriteAction,
  SocialPlatform,
} from '@ass/shared';
import {
  contentLanguages,
  contentToneLabels,
  contentTones,
  contentTypeLabels,
  contentTypeSchema,
  contentTypes,
  platformSpecs,
  rewriteActionLabels,
  rewriteActions,
  socialPlatformLabels,
  socialPlatforms,
} from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, formatDate, PageHeader } from '../components/ui';

const SPEC_BRIEF_EXAMPLE =
  'Crée une publication professionnelle pour annoncer notre nouvelle formation en intelligence artificielle. Le ton doit être dynamique et accessible. Encourage les personnes intéressées à s’inscrire.';

interface Draft {
  title: string;
  body: string;
  hashtags: string;
}

function draftsFrom(detail: ContentProjectDetail): Record<string, Draft> {
  return Object.fromEntries(
    detail.variants.map((variant) => [
      variant.id,
      {
        title: variant.title ?? '',
        body: variant.body,
        hashtags: variant.hashtags.join(' '),
      },
    ]),
  );
}

function parseHashtags(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
}

function countChars(body: string, hashtags: string): number {
  const tags = parseHashtags(hashtags);
  return body.length + (tags.length > 0 ? 1 + tags.join(' ').length : 0);
}

function counterTone(count: number, platform: SocialPlatform): string {
  const spec = platformSpecs[platform];
  if (count > spec.maxChars) return 'text-danger';
  if (count > spec.recommendedChars) return 'text-accent';
  return 'text-success';
}

export function ContentStudioPage() {
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [detail, setDetail] = useState<ContentProjectDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const [brief, setBrief] = useState('');
  const [brandId, setBrandId] = useState('');
  const [contentType, setContentType] = useState<ContentType>('PROMO');
  const [tone, setTone] = useState<ContentTone>('PROFESSIONAL');
  const [language, setLanguage] = useState<ContentLanguage>('FR');
  const [platforms, setPlatforms] = useState<SocialPlatform[]>(['LINKEDIN']);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const refresh = () => setReload((n) => n + 1);

  useEffect(() => {
    let active = true;
    Promise.all([api.content.list(), api.brands.list()])
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

  function applyDetail(next: ContentProjectDetail) {
    setDetail(next);
    setDrafts(draftsFrom(next));
  }

  async function open(id: string) {
    const loaded = await run(() => api.content.detail(id), 'Projet introuvable');
    if (loaded) applyDetail(loaded);
  }

  function togglePlatform(platform: SocialPlatform) {
    setPlatforms((current) =>
      current.includes(platform)
        ? current.filter((value) => value !== platform)
        : [...current, platform],
    );
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    setNotice('');
    const created = await run(
      () =>
        api.contentGeneration.generate({
          brief,
          platforms,
          contentType,
          tone,
          language,
          ...(brandId ? { brandId } : {}),
        }),
      'Génération impossible',
    );
    if (!created) return;
    applyDetail(created);
    refresh();
    setNotice(
      `${created.variants.length} variante(s) générée(s) pour « ${created.subject ?? created.brief.slice(0, 40)} ».`,
    );
  }

  async function saveVariant(variant: ContentVariant) {
    if (!detail) return;
    const draft = drafts[variant.id];
    if (!draft) return;
    const updated = await run(
      () =>
        api.content.updateVariant(detail.id, variant.id, {
          body: draft.body,
          hashtags: parseHashtags(draft.hashtags),
          ...(draft.title ? { title: draft.title } : {}),
        }),
      'Enregistrement impossible',
    );
    if (!updated) return;
    applyDetail(updated);
    setNotice(`Variante ${socialPlatformLabels[variant.platform]} enregistrée.`);
  }

  async function runAssistant(variant: ContentVariant, action: RewriteAction) {
    if (!detail) return;
    setNotice('');
    const updated = await run(
      () => api.content.rewrite(detail.id, variant.id, { action }),
      'Action impossible',
    );
    if (!updated) return;
    applyDetail(updated);
    const target = updated.variants.find(
      (item) => item.platform === variant.platform && item.language === variant.language,
    );
    setNotice(
      `« ${rewriteActionLabels[action]} » appliqué à ${socialPlatformLabels[variant.platform]}${
        target && action === 'TRANSLATE' ? ` (version ${target.language})` : ''
      }.`,
    );
  }

  async function copyVariant(variant: ContentVariant) {
    const draft = drafts[variant.id];
    const text =
      `${draft?.body ?? variant.body}\n\n${parseHashtags(draft?.hashtags ?? '').join(' ')}`.trim();
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`Texte ${socialPlatformLabels[variant.platform]} copié.`);
    } catch {
      setError('Copie impossible : sélectionnez le texte manuellement.');
    }
  }

  async function remove(id: string) {
    const done = await run(() => api.content.remove(id), 'Suppression impossible');
    if (done === null) return;
    if (detail?.id === id) {
      setDetail(null);
      setDrafts({});
    }
    refresh();
  }

  function updateDraft(variantId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [variantId]: { ...current[variantId]!, ...patch },
    }));
  }

  const canGenerate = brief.trim().length >= 20 && platforms.length > 0 && !busy;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Content Studio"
        description="Décrivez votre besoin en langage naturel : le studio produit une variante par réseau, calibrée sur les limites réelles de chaque plateforme."
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
            <h2 className="mb-4 font-medium">Nouveau contenu</h2>
            <form onSubmit={generate} className="space-y-3">
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Votre brief</span>
                <textarea
                  required
                  minLength={20}
                  rows={5}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder={SPEC_BRIEF_EXAMPLE}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <span className="block text-xs text-text-muted">
                  {brief.trim().length} / 20 caractères minimum
                </span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1.5">
                  <span className="block text-xs text-text-muted">Type</span>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(contentTypeSchema.parse(e.target.value))}
                    className="w-full rounded-lg border border-border bg-bg px-2 py-2 text-sm outline-none focus:border-accent"
                  >
                    {contentTypes.map((value) => (
                      <option key={value} value={value}>
                        {contentTypeLabels[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="block text-xs text-text-muted">Ton</span>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value as ContentTone)}
                    className="w-full rounded-lg border border-border bg-bg px-2 py-2 text-sm outline-none focus:border-accent"
                  >
                    {contentTones.map((value) => (
                      <option key={value} value={value}>
                        {contentToneLabels[value]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1.5">
                  <span className="block text-xs text-text-muted">Langue</span>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as ContentLanguage)}
                    className="w-full rounded-lg border border-border bg-bg px-2 py-2 text-sm outline-none focus:border-accent"
                  >
                    {contentLanguages.map((value) => (
                      <option key={value} value={value}>
                        {value === 'FR' ? 'Français' : 'Anglais'}
                      </option>
                    ))}
                  </select>
                </label>
                {brands.length > 0 && (
                  <label className="block space-y-1.5">
                    <span className="block text-xs text-text-muted">Marque</span>
                    <select
                      value={brandId}
                      onChange={(e) => setBrandId(e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg px-2 py-2 text-sm outline-none focus:border-accent"
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
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Réseaux ciblés</legend>
                <div className="flex flex-wrap gap-1.5">
                  {socialPlatforms.map((platform) => {
                    const active = platforms.includes(platform);
                    return (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => togglePlatform(platform)}
                        aria-pressed={active}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          active
                            ? 'border-accent bg-accent/12 font-medium text-accent'
                            : 'border-border text-text-muted hover:border-accent hover:text-accent'
                        }`}
                      >
                        {socialPlatformLabels[platform]}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <Button type="submit" disabled={!canGenerate}>
                {busy ? 'Génération…' : 'Générer les variantes'}
              </Button>
              <button
                type="button"
                onClick={() => setBrief(SPEC_BRIEF_EXAMPLE)}
                className="block text-xs text-text-muted underline-offset-2 hover:text-accent hover:underline"
              >
                Utiliser l’exemple du cahier des charges
              </button>
            </form>
          </Card>

          <Card>
            <h2 className="mb-3 font-medium">Contenus</h2>
            {projects.length === 0 ? (
              <Empty>Aucun contenu généré.</Empty>
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
                      <span className="block truncate font-medium">
                        {project.subject ?? project.brief.slice(0, 40)}
                      </span>
                      <span className="block text-xs">
                        {contentTypeLabels[project.contentType]} · {project.variantCount}{' '}
                        variante(s)
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
            <Empty>Générez un contenu ou sélectionnez-en un pour voir ses variantes.</Empty>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">
                    {detail.subject ?? detail.brief.slice(0, 60)}
                  </h2>
                  <p className="text-xs text-text-muted">
                    {contentTypeLabels[detail.contentType]} · {contentToneLabels[detail.tone]} ·{' '}
                    {detail.language} · {formatDate(detail.createdAt)}
                  </p>
                  {detail.objective && (
                    <p className="mt-1 text-xs text-text-muted">Objectif : {detail.objective}</p>
                  )}
                </div>
                <Button variant="danger" onClick={() => void remove(detail.id)}>
                  Supprimer
                </Button>
              </div>

              <p className="rounded-lg border border-border bg-bg p-3 text-xs text-text-muted">
                Brief : {detail.brief}
              </p>

              <ul className="space-y-4">
                {detail.variants.map((variant) => {
                  const draft = drafts[variant.id] ?? {
                    title: variant.title ?? '',
                    body: variant.body,
                    hashtags: variant.hashtags.join(' '),
                  };
                  const spec = platformSpecs[variant.platform];
                  const count = countChars(draft.body, draft.hashtags);
                  const dirty =
                    draft.body !== variant.body ||
                    draft.title !== (variant.title ?? '') ||
                    draft.hashtags !== variant.hashtags.join(' ');
                  return (
                    <li key={variant.id} className="rounded-lg border border-border p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {socialPlatformLabels[variant.platform]}
                          </span>
                          <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-text-muted">
                            {variant.language}
                          </span>
                          {variant.edited && (
                            <span className="rounded-md border border-accent/40 px-1.5 py-0.5 text-xs text-accent">
                              modifié
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-xs tabular-nums ${counterTone(count, variant.platform)}`}
                        >
                          {count} / {spec.maxChars}
                        </span>
                      </div>

                      <p className="mb-2 text-xs text-text-muted">{spec.guidance}</p>

                      {spec.titleMaxChars !== undefined && (
                        <label className="mb-2 block space-y-1">
                          <span className="block text-xs text-text-muted">
                            Titre ({draft.title.length} / {spec.titleMaxChars})
                          </span>
                          <input
                            value={draft.title}
                            onChange={(e) => updateDraft(variant.id, { title: e.target.value })}
                            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
                          />
                        </label>
                      )}

                      <label className="block space-y-1">
                        <span className="block text-xs text-text-muted">Texte</span>
                        <textarea
                          rows={6}
                          value={draft.body}
                          onChange={(e) => updateDraft(variant.id, { body: e.target.value })}
                          className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
                        />
                      </label>

                      <label className="mt-2 block space-y-1">
                        <span className="block text-xs text-text-muted">
                          Hashtags (max {spec.maxHashtags})
                        </span>
                        <input
                          value={draft.hashtags}
                          onChange={(e) => updateDraft(variant.id, { hashtags: e.target.value })}
                          className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
                        />
                      </label>

                      {variant.warnings.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {variant.warnings.map((warning) => (
                            <li key={warning} className="text-xs text-accent">
                              {warning}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-2">
                        {rewriteActions.map((action) => (
                          <Button
                            key={action}
                            variant="ghost"
                            onClick={() => void runAssistant(variant, action)}
                            disabled={busy}
                            className="px-2 py-1 text-xs"
                          >
                            {rewriteActionLabels[action]}
                          </Button>
                        ))}
                        <Button
                          onClick={() => void saveVariant(variant)}
                          disabled={busy || !dirty}
                          className="px-2 py-1 text-xs"
                        >
                          Enregistrer
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => void copyVariant(variant)}
                          className="px-2 py-1 text-xs"
                        >
                          Copier
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <p className="border-t border-border pt-3 text-xs text-text-muted">
                Mode démonstration : les textes sont assemblés localement (AI_PROVIDER=mock), sans
                appel externe. Un modèle de langage réel se branche côté API, avec les mêmes
                contrats.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
