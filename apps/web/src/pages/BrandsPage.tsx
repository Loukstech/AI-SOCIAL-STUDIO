import { useEffect, useState, type FormEvent } from 'react';
import type { Brand } from '@ass/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, Empty, Field, formatDate, PageHeader } from '../components/ui';

export function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#7c5cff');
  const [toneOfVoice, setToneOfVoice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const refresh = () => setReload((n) => n + 1);

  useEffect(() => {
    let active = true;
    api.brands
      .list()
      .then((list) => {
        if (active) setBrands(list);
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
      await api.brands.create({
        name,
        ...(description ? { description } : {}),
        ...(primaryColor ? { primaryColor } : {}),
        ...(toneOfVoice ? { toneOfVoice } : {}),
      });
      setName('');
      setDescription('');
      setToneOfVoice('');
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Création impossible');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.brands.remove(id);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Suppression impossible');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marques"
        description="Couleurs, ton de voix et identité : la base du Brand Kit."
      />
      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-medium">Nouvelle marque</h2>
          <form onSubmit={create} className="space-y-4">
            <Field
              label="Nom"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Nova Studio"
            />
            <Field
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Positionnement, audience…"
            />
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Couleur principale"
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
              />
              <Field
                label="Ton de voix"
                value={toneOfVoice}
                onChange={(e) => setToneOfVoice(e.target.value)}
                placeholder="Inspirant, direct…"
              />
            </div>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              {busy ? 'Création…' : 'Créer la marque'}
            </Button>
          </form>
        </Card>

        <Card>
          <h2 className="mb-4 font-medium">Marques existantes</h2>
          {brands.length === 0 ? (
            <Empty>Aucune marque pour cette organisation.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {brands.map((brand) => (
                <li key={brand.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="flex gap-3">
                    <span
                      className="mt-1 h-8 w-8 shrink-0 rounded-md border border-border"
                      style={{ background: brand.primaryColor ?? 'transparent' }}
                    />
                    <div>
                      <p className="font-medium">{brand.name}</p>
                      {brand.description && (
                        <p className="text-sm text-text-muted">{brand.description}</p>
                      )}
                      <p className="text-xs text-text-muted">
                        {brand.toneOfVoice ? `${brand.toneOfVoice} · ` : ''}
                        {formatDate(brand.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Button variant="danger" onClick={() => void remove(brand.id)}>
                    Supprimer
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
