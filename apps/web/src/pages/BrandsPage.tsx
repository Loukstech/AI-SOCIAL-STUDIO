import { useEffect, useState, type FormEvent } from 'react';
import {
  socialPlatformLabels,
  socialPlatforms,
  type Brand,
  type BrandSocialLink,
  type MediaAsset,
  type SocialPlatform,
} from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader } from '../components/ui';

/**
 * Brand Kit (§8).
 *
 * Une marque porte son identité complète : palette, polices, slogan, contacts,
 * liens sociaux, logos et images de référence. Les logos sont **référencés par
 * identifiant de média** — le fichier d'origine n'est jamais copié ni réécrit.
 */

interface Kit {
  name: string;
  description: string;
  primaryColor: string;
  toneOfVoice: string;
  slogan: string;
  website: string;
  contactEmail: string;
  contactPhone: string;
  headingFont: string;
  bodyFont: string;
  editorialInstructions: string;
  palette: string[];
  logoPrimaryId: string;
  logoSecondaryId: string;
  referenceImageIds: string[];
  socialLinks: BrandSocialLink[];
}

const emptyKit: Kit = {
  name: '',
  description: '',
  primaryColor: '',
  toneOfVoice: '',
  slogan: '',
  website: '',
  contactEmail: '',
  contactPhone: '',
  headingFont: '',
  bodyFont: '',
  editorialInstructions: '',
  palette: [],
  logoPrimaryId: '',
  logoSecondaryId: '',
  referenceImageIds: [],
  socialLinks: [],
};

function kitFrom(brand: Brand): Kit {
  return {
    name: brand.name,
    description: brand.description ?? '',
    primaryColor: brand.primaryColor ?? '',
    toneOfVoice: brand.toneOfVoice ?? '',
    slogan: brand.slogan ?? '',
    website: brand.website ?? '',
    contactEmail: brand.contactEmail ?? '',
    contactPhone: brand.contactPhone ?? '',
    headingFont: brand.headingFont ?? '',
    bodyFont: brand.bodyFont ?? '',
    editorialInstructions: brand.editorialInstructions ?? '',
    palette: brand.palette,
    logoPrimaryId: brand.logoPrimaryId ?? '',
    logoSecondaryId: brand.logoSecondaryId ?? '',
    referenceImageIds: brand.referenceImageIds,
    socialLinks: brand.socialLinks,
  };
}

/** Une chaîne vide devient `null` : c'est ainsi que le contrat vide un champ. */
function nullable(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

export function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kit, setKit] = useState<Kit>(emptyKit);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#7c5cff');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const refresh = () => setReload((n) => n + 1);
  const patch = (values: Partial<Kit>) => setKit((prev) => ({ ...prev, ...values }));

  useEffect(() => {
    let active = true;
    Promise.all([api.brands.list(), api.media.list()])
      .then(([brandList, mediaList]) => {
        if (!active) return;
        setBrands(brandList);
        setMedia(mediaList);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Erreur de chargement');
      });
    return () => {
      active = false;
    };
  }, [reload]);

  function select(brand: Brand) {
    setSelectedId(brand.id);
    setKit(kitFrom(brand));
    setError('');
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const brand = await api.brands.create({
        name,
        ...(description ? { description } : {}),
        ...(primaryColor ? { primaryColor } : {}),
      });
      setName('');
      setDescription('');
      setSelectedId(brand.id);
      setKit(kitFrom(brand));
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Création impossible');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!selectedId) return;
    setError('');
    setBusy(true);
    try {
      const brand = await api.brands.update(selectedId, {
        name: kit.name.trim(),
        description: nullable(kit.description),
        primaryColor: kit.primaryColor ? kit.primaryColor : null,
        toneOfVoice: nullable(kit.toneOfVoice),
        slogan: nullable(kit.slogan),
        website: nullable(kit.website),
        contactEmail: nullable(kit.contactEmail),
        contactPhone: nullable(kit.contactPhone),
        headingFont: nullable(kit.headingFont),
        bodyFont: nullable(kit.bodyFont),
        editorialInstructions: nullable(kit.editorialInstructions),
        palette: kit.palette,
        logoPrimaryId: kit.logoPrimaryId ? kit.logoPrimaryId : null,
        logoSecondaryId: kit.logoSecondaryId ? kit.logoSecondaryId : null,
        referenceImageIds: kit.referenceImageIds,
        socialLinks: kit.socialLinks.filter((link) => link.url.trim().length > 0),
      });
      setKit(kitFrom(brand));
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enregistrement impossible');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await api.brands.remove(id);
      if (selectedId === id) {
        setSelectedId(null);
        setKit(emptyKit);
      }
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Suppression impossible');
    }
  }

  function addLink() {
    const link: BrandSocialLink = { platform: 'INSTAGRAM', url: '' };
    patch({ socialLinks: [...kit.socialLinks, link].slice(0, 8) });
  }

  function updateLink(index: number, values: Partial<BrandSocialLink>) {
    patch({
      socialLinks: kit.socialLinks.map((link, position) =>
        position === index ? { ...link, ...values } : link,
      ),
    });
  }

  function toggleReference(id: string) {
    const present = kit.referenceImageIds.includes(id);
    patch({
      referenceImageIds: present
        ? kit.referenceImageIds.filter((value) => value !== id)
        : [...kit.referenceImageIds, id].slice(0, 12),
    });
  }

  const images = media.filter((asset) => asset.kind === 'IMAGE');
  const selected = brands.find((brand) => brand.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marques et Brand Kit"
        description="Palette, polices, logos, contacts et consignes éditoriales : la source de vérité visuelle de chaque marque."
      />
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <h2 className="mb-4 font-medium">Nouvelle marque</h2>
            <form onSubmit={create} className="space-y-4">
              <Field
                label="Nom"
                required
                minLength={2}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex. Nova Studio"
              />
              <Field
                label="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Positionnement, audience…"
              />
              <Field
                label="Couleur principale"
                type="color"
                value={primaryColor}
                onChange={(event) => setPrimaryColor(event.target.value)}
              />
              <Button type="submit" disabled={busy || name.trim().length < 2}>
                {busy ? 'Création…' : 'Créer la marque'}
              </Button>
            </form>
          </Card>

          <Card>
            <h2 className="mb-3 font-medium">Marques</h2>
            {brands.length === 0 ? (
              <Empty>Aucune marque pour cette organisation.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {brands.map((brand) => (
                  <li key={brand.id}>
                    <button
                      type="button"
                      onClick={() => select(brand)}
                      className={`flex w-full items-center gap-3 py-2.5 text-left transition-colors ${
                        brand.id === selectedId ? 'text-accent' : 'hover:text-accent'
                      }`}
                    >
                      <span
                        className="h-7 w-7 shrink-0 rounded-md border border-border"
                        style={{ background: brand.primaryColor ?? 'transparent' }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{brand.name}</span>
                        <span className="block text-xs text-text-muted">
                          {brand.palette.length} couleur{brand.palette.length > 1 ? 's' : ''} ·{' '}
                          {formatDate(brand.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          {selected === null ? (
            <Empty>Créez ou sélectionnez une marque pour éditer son Brand Kit.</Empty>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium">{selected.name}</h2>
                  <p className="text-xs text-text-muted">
                    Créée le {formatDate(selected.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => void save()} disabled={busy || kit.name.trim().length < 2}>
                    {busy ? 'Enregistrement…' : 'Enregistrer le kit'}
                  </Button>
                  <Button variant="danger" onClick={() => void remove(selected.id)}>
                    Supprimer
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Nom"
                  required
                  minLength={2}
                  value={kit.name}
                  onChange={(event) => patch({ name: event.target.value })}
                />
                <Field
                  label="Slogan"
                  maxLength={160}
                  value={kit.slogan}
                  onChange={(event) => patch({ slogan: event.target.value })}
                  placeholder="Ex. Le contenu, sans bruit"
                />
              </div>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Description</span>
                <textarea
                  rows={2}
                  value={kit.description}
                  onChange={(event) => patch({ description: event.target.value })}
                  placeholder="Positionnement, audience, promesse…"
                  className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Ton de voix"
                  maxLength={300}
                  value={kit.toneOfVoice}
                  onChange={(event) => patch({ toneOfVoice: event.target.value })}
                  placeholder="Inspirant, direct, sans jargon…"
                />
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field
                      label="Couleur principale"
                      type="color"
                      value={kit.primaryColor || '#7c5cff'}
                      onChange={(event) => patch({ primaryColor: event.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => patch({ primaryColor: '' })}
                    disabled={kit.primaryColor === ''}
                  >
                    Effacer
                  </Button>
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Palette</legend>
                <p className="text-xs text-text-muted">
                  Ordonnée du fond vers l'accent. Huit couleurs maximum.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {kit.palette.map((color, index) => (
                    <span key={`${color}-${index}`} className="flex items-center gap-1">
                      <input
                        type="color"
                        value={color}
                        aria-label={`Couleur ${index + 1}`}
                        onChange={(event) => {
                          const next = [...kit.palette];
                          next[index] = event.target.value;
                          patch({ palette: next });
                        }}
                        className="h-8 w-10 rounded border border-border bg-bg"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          patch({ palette: kit.palette.filter((_, i) => i !== index) })
                        }
                        className="text-xs text-text-muted hover:text-danger"
                      >
                        retirer
                      </button>
                    </span>
                  ))}
                  {kit.palette.length < 8 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => patch({ palette: [...kit.palette, '#7c5cff'] })}
                    >
                      Ajouter
                    </Button>
                  )}
                </div>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Police des titres"
                  maxLength={80}
                  value={kit.headingFont}
                  onChange={(event) => patch({ headingFont: event.target.value })}
                  placeholder="Ex. Inter Tight"
                />
                <Field
                  label="Police du texte"
                  maxLength={80}
                  value={kit.bodyFont}
                  onChange={(event) => patch({ bodyFont: event.target.value })}
                  placeholder="Ex. Inter"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="block text-sm font-medium">Logo principal</span>
                  <select
                    value={kit.logoPrimaryId}
                    onChange={(event) => patch({ logoPrimaryId: event.target.value })}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                  >
                    <option value="">Aucun</option>
                    {images.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="block text-sm font-medium">Logo secondaire</span>
                  <select
                    value={kit.logoSecondaryId}
                    onChange={(event) => patch({ logoSecondaryId: event.target.value })}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                  >
                    <option value="">Aucun</option>
                    {images.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Images de référence</legend>
                <p className="text-xs text-text-muted">
                  Servent de fond voilé dans l'Image Studio. Douze au maximum.
                </p>
                {images.length === 0 ? (
                  <p className="text-xs text-text-muted">Aucune image dans la médiathèque.</p>
                ) : (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {images.map((asset) => (
                      <li key={asset.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={kit.referenceImageIds.includes(asset.id)}
                            onChange={() => toggleReference(asset.id)}
                          />
                          <span className="truncate">{asset.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  label="Site web"
                  type="url"
                  value={kit.website}
                  onChange={(event) => patch({ website: event.target.value })}
                  placeholder="https://…"
                />
                <Field
                  label="E-mail de contact"
                  type="email"
                  value={kit.contactEmail}
                  onChange={(event) => patch({ contactEmail: event.target.value })}
                />
                <Field
                  label="Téléphone"
                  maxLength={40}
                  value={kit.contactPhone}
                  onChange={(event) => patch({ contactPhone: event.target.value })}
                />
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Liens sociaux</legend>
                {kit.socialLinks.length === 0 && (
                  <p className="text-xs text-text-muted">Aucun lien enregistré.</p>
                )}
                {kit.socialLinks.map((link, index) => (
                  <div key={`${link.platform}-${index}`} className="flex gap-2">
                    <select
                      value={link.platform}
                      onChange={(event) =>
                        updateLink(index, { platform: event.target.value as SocialPlatform })
                      }
                      aria-label={`Plateforme du lien ${index + 1}`}
                      className="rounded-lg border border-border bg-bg px-2 py-2 text-sm outline-none focus:border-accent"
                    >
                      {socialPlatforms.map((platform) => (
                        <option key={platform} value={platform}>
                          {socialPlatformLabels[platform]}
                        </option>
                      ))}
                    </select>
                    <input
                      type="url"
                      value={link.url}
                      onChange={(event) => updateLink(index, { url: event.target.value })}
                      placeholder="https://…"
                      aria-label={`URL du lien ${index + 1}`}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        patch({
                          socialLinks: kit.socialLinks.filter((_, position) => position !== index),
                        })
                      }
                    >
                      Retirer
                    </Button>
                  </div>
                ))}
                {kit.socialLinks.length < 8 && (
                  <Button type="button" variant="ghost" onClick={addLink}>
                    Ajouter un lien
                  </Button>
                )}
              </fieldset>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Consignes éditoriales</span>
                <textarea
                  rows={3}
                  value={kit.editorialInstructions}
                  onChange={(event) => patch({ editorialInstructions: event.target.value })}
                  placeholder="Ce que la marque dit, ce qu'elle ne dit jamais, les formules à éviter…"
                  className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </label>

              <p className="border-t border-border pt-3 text-xs text-text-muted">
                Les logos sont référencés par identifiant de média : le fichier d'origine n'est ni
                copié ni modifié.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
