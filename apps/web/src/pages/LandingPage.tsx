import { Button, Card } from '../components/ui';

const features = [
  {
    title: 'Une idée, huit réseaux',
    body: 'Générez un contenu, adaptez-le automatiquement à chaque plateforme et respectez ses limites réelles.',
  },
  {
    title: 'Vidéo, images et marque',
    body: 'Transcription éditable, sous-titres, meilleurs passages, visuels vectoriels et Brand Kit cohérent.',
  },
  {
    title: 'Publication maîtrisée',
    body: 'Validation, programmation, calendrier éditorial, analytics honnêtes et espace client.',
  },
];

/** Page publique autonome : aucune donnée, aucun appel réseau, aucune clé. */
export function LandingPage({ onEnter }: { onEnter: () => void }) {
  return (
    <main className="min-h-dvh bg-bg px-5 py-10 text-text">
      <div className="mx-auto max-w-5xl space-y-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-lg font-semibold tracking-tight">AI Social Studio</p>
          <Button onClick={onEnter}>Ouvrir l'application</Button>
        </header>

        <section className="space-y-5">
          <p className="text-sm font-medium uppercase tracking-widest text-accent">
            Studio de production assisté par IA
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            De l'idée à la campagne multiréseaux, depuis un seul espace.
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-text-muted">
            AI Social Studio réunit la création vidéo, la rédaction, les visuels de marque, la
            publication et la collaboration client. Les chiffres non mesurés restent vides plutôt
            que d'être inventés.
          </p>
          <Button onClick={onEnter}>Commencer</Button>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="space-y-2">
              <h2 className="text-base font-semibold">{feature.title}</h2>
              <p className="text-sm leading-relaxed text-text-muted">{feature.body}</p>
            </Card>
          ))}
        </section>

        <footer className="border-t border-border pt-6 text-xs text-text-muted">
          Démonstration en développement · les intégrations externes ne sont pas activées.
        </footer>
      </div>
    </main>
  );
}
