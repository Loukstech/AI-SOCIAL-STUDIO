import { useEffect, useState, type FormEvent } from 'react';
import type { MediaAsset, MediaKind } from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader } from '../components/ui';

const kinds: { value: MediaKind; label: string }[] = [
  { value: 'IMAGE', label: 'Image' },
  { value: 'VIDEO', label: 'Vidéo' },
  { value: 'AUDIO', label: 'Audio' },
  { value: 'DOCUMENT', label: 'Document' },
];

export function MediaPage() {
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<MediaKind>('IMAGE');
  const [sourceUrl, setSourceUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const refresh = () => setReload((n) => n + 1);

  useEffect(() => {
    let active = true;
    api.media
      .list()
      .then((list) => {
        if (active) setMedia(list);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Erreur de chargement');
      });
    return () => {
      active = false;
    };
  }, [reload]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.media.create({ name, kind, ...(sourceUrl ? { sourceUrl } : {}) });
      setName('');
      setSourceUrl('');
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ajout impossible');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.media.remove(id);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Suppression impossible');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Médiathèque"
        description="Bibliothèque de métadonnées. Le dépôt de fichiers binaires sera branché sur le stockage objet à la phase suivante."
      />
      {error && <Alert>{error}</Alert>}

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
              value={kind}
              onChange={(e) => setKind(e.target.value as MediaKind)}
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
            label="URL source (facultatif)"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
          />
          <div className="flex items-end">
            <Button type="submit" disabled={busy || name.trim().length === 0} className="w-full">
              {busy ? 'Ajout…' : 'Ajouter'}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="mb-4 font-medium">Bibliothèque</h2>
        {media.length === 0 ? (
          <Empty>Aucun média enregistré.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-muted">
                <tr>
                  <th className="pb-2 font-medium">Nom</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Ajouté le</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {media.map((asset) => (
                  <tr key={asset.id}>
                    <td className="py-2 font-medium">{asset.name}</td>
                    <td className="py-2 font-mono text-xs">{asset.kind}</td>
                    <td className="py-2 text-xs text-text-muted">{formatDate(asset.createdAt)}</td>
                    <td className="py-2 text-right">
                      <Button variant="danger" onClick={() => void remove(asset.id)}>
                        Supprimer
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
