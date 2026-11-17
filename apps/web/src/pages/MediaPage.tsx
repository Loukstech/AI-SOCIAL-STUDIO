import { useCallback, useState, type FormEvent } from 'react';
import type { MediaAsset, MediaKind, MediaQuery } from '@ass/shared';
import { api } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader } from '../components/ui';

const kinds: { value: MediaKind; label: string }[] = [
  { value: 'IMAGE', label: 'Image' },
  { value: 'VIDEO', label: 'Vidéo' },
  { value: 'AUDIO', label: 'Audio' },
  { value: 'DOCUMENT', label: 'Document' },
  { value: 'LOGO', label: 'Logo' },
  { value: 'PROJECT', label: 'Projet' },
  { value: 'EXPORT', label: 'Export' },
];

export function MediaPage() {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<MediaKind | ''>('');
  const [folder, setFolder] = useState('');
  const [tag, setTag] = useState('');
  const [favoriteFilter, setFavoriteFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const [name, setName] = useState('');
  const [newKind, setNewKind] = useState<MediaKind>('IMAGE');
  const [sourceUrl, setSourceUrl] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const [newTags, setNewTags] = useState('');
  const [checksum, setChecksum] = useState('');
  const [rights, setRights] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const fetcher = useCallback(async () => {
    const query: Partial<MediaQuery> = {
      ...(search ? { search } : {}),
      ...(kind ? { kind } : {}),
      ...(folder ? { folder } : {}),
      ...(tag ? { tag } : {}),
      ...(favoriteFilter ? { favorite: favoriteFilter as 'true' | 'false' } : {}),
    };
    const [media, duplicates, versions] = await Promise.all([
      api.media.list(query),
      api.media.duplicates(),
      selectedId ? api.media.versions(selectedId) : Promise.resolve([]),
    ]);
    return { media, duplicates, versions };
  }, [search, kind, folder, tag, favoriteFilter, selectedId]);

  const { data, error, reload } = useAsyncData(fetcher);
  const media = data?.media ?? [];
  const duplicates = data?.duplicates ?? [];
  const versions = data?.versions ?? [];

  async function create(event: FormEvent) {
    event.preventDefault();
    setActionError('');
    setBusy(true);
    try {
      await api.media.create({
        name,
        kind: newKind,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(newFolder ? { folder: newFolder } : {}),
        ...(newTags ? { tags: splitTags(newTags) } : {}),
        ...(checksum ? { checksum } : {}),
        ...(rights ? { rights } : {}),
      });
      setName('');
      setSourceUrl('');
      setNewTags('');
      setChecksum('');
      setRights('');
      reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Ajout impossible');
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(asset: MediaAsset) {
    try {
      await api.media.update(asset.id, { favorite: !asset.favorite });
      reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Mise à jour impossible');
    }
  }

  async function remove(id: string) {
    try {
      await api.media.remove(id);
      if (selectedId === id) setSelectedId('');
      reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Suppression impossible');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Médiathèque"
        description="Recherche, dossiers, tags, favoris, versions et doublons. Les fichiers binaires restent dans un stockage objet ; seule la référence est enregistrée ici."
      />
      {(error || actionError) && <Alert>{error || actionError}</Alert>}

      <Card>
        <h2 className="mb-4 font-medium">Ajouter un média</h2>
        <form onSubmit={create} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Nom"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex. Visuel campagne"
          />
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Type</span>
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as MediaKind)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            >
              {kinds.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="URL source"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
          />
          <Field
            label="Dossier"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            placeholder="Campagnes/2026"
          />
          <Field
            label="Tags (séparés par des virgules)"
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            placeholder="validé, été"
          />
          <Field
            label="Empreinte (doublons)"
            value={checksum}
            onChange={(e) => setChecksum(e.target.value)}
            placeholder="sha256…"
          />
          <Field
            label="Droits d’usage"
            value={rights}
            onChange={(e) => setRights(e.target.value)}
            placeholder="Licence interne"
          />
          <div className="flex items-end">
            <Button type="submit" disabled={busy || name.trim().length === 0} className="w-full">
              {busy ? 'Ajout…' : 'Ajouter'}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="mb-4 font-medium">Recherche et filtres</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field
            label="Rechercher"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nom, dossier ou tag"
          />
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Type</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as MediaKind | '')}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="">Tous</option>
              {kinds.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Dossier exact"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="Campagnes/2026"
          />
          <Field
            label="Tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="validé"
          />
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Favoris</span>
            <select
              value={favoriteFilter}
              onChange={(e) => setFavoriteFilter(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="">Tous</option>
              <option value="true">Favoris seulement</option>
              <option value="false">Non favoris</option>
            </select>
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-medium">Bibliothèque</h2>
        {media.length === 0 ? (
          <Empty>Aucun média ne correspond à ces filtres.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-muted">
                <tr>
                  <th className="pb-2 font-medium">Nom</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Dossier</th>
                  <th className="pb-2 font-medium">Tags</th>
                  <th className="pb-2 font-medium">Ajouté le</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {media.map((asset) => (
                  <tr key={asset.id}>
                    <td className="py-2 font-medium">{asset.name}</td>
                    <td className="py-2 font-mono text-xs">{asset.kind}</td>
                    <td className="py-2 text-xs">{asset.folder ?? '—'}</td>
                    <td className="py-2 text-xs">{asset.tags.join(', ') || '—'}</td>
                    <td className="py-2 text-xs text-text-muted">{formatDate(asset.createdAt)}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant={asset.favorite ? 'primary' : 'ghost'}
                          onClick={() => void toggleFavorite(asset)}
                        >
                          {asset.favorite ? '★ Favori' : '☆ Favori'}
                        </Button>
                        <Button variant="ghost" onClick={() => setSelectedId(asset.id)}>
                          Versions
                        </Button>
                        <Button variant="danger" onClick={() => void remove(asset.id)}>
                          Supprimer
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-medium">Doublons détectés</h2>
          {duplicates.length === 0 ? (
            <Empty>Aucune empreinte partagée.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {duplicates.map((group) => (
                <li key={group.checksum} className="rounded-lg border border-border p-3">
                  <span className="font-mono text-xs text-text-muted">{group.checksum}</span>
                  <p>{group.assets.map((asset) => asset.name).join(' · ')}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-4 font-medium">Versions</h2>
          {!selectedId ? (
            <Empty>Sélectionnez un média pour voir ses versions.</Empty>
          ) : versions.length === 0 ? (
            <Empty>Aucune version enregistrée.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {versions.map((asset) => (
                <li
                  key={asset.id}
                  className="flex justify-between rounded-lg border border-border p-3"
                >
                  <span>{asset.name}</span>
                  <span className="text-xs text-text-muted">{formatDate(asset.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function splitTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}
