import { useState, type FormEvent } from 'react';
import { api, setActiveOrganization, setSessionToken } from '../lib/api';

interface Props {
  onAuthenticated: () => void;
}

export function AuthPage({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response =
        mode === 'login'
          ? await api.login({ email, password })
          : await api.register({
              email,
              password,
              name,
              ...(organizationName ? { organizationName } : {}),
            });
      setSessionToken(response.token);
      setActiveOrganization(null);
      onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Une erreur est survenue');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <header className="space-y-2 text-center">
        <p className="text-sm font-medium text-accent">Phase 1 · Fondations SaaS</p>
        <h1 className="text-3xl font-semibold tracking-tight">AI Social Studio</h1>
        <p className="text-sm text-text-muted">
          Créez votre espace de travail, gérez vos marques et préparez vos contenus.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-surface p-6">
        <div className="mb-5 flex rounded-lg border border-border p-1">
          {(['login', 'register'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
                setError('');
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === value ? 'bg-accent text-bg' : 'text-text-muted hover:text-text'
              }`}
            >
              {value === 'login' ? 'Connexion' : 'Créer un compte'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'register' && (
            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">Votre nom</span>
              <input
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
          )}
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Adresse e-mail</span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Mot de passe</span>
            <input
              required
              type="password"
              minLength={mode === 'register' ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {mode === 'register' && (
              <span className="block text-xs text-text-muted">Au moins 8 caractères.</span>
            )}
          </label>
          {mode === 'register' && (
            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">Nom de l'organisation</span>
              <input
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="Facultatif"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Patientez…' : mode === 'login' ? 'Se connecter' : 'Créer mon espace'}
          </button>
        </form>
      </section>

      <p className="text-center text-xs text-text-muted">
        Vos données sont isolées par organisation. Les comptes sociaux et l'IA arrivent aux phases
        suivantes.
      </p>
    </main>
  );
}
