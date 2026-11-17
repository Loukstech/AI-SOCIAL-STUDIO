import { useState, type FormEvent } from 'react';
import { api, setActiveOrganization, setSessionToken } from '../lib/api';

interface Props {
  onAuthenticated: () => void;
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength: number;
  visible: boolean;
  onToggleVisibility: () => void;
  hint?: string;
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.4 3.1M6.2 7.5C3.9 9 2.5 12 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.2 3.3-.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  visible,
  onToggleVisibility,
  hint,
}: PasswordFieldProps) {
  const action = visible ? 'Masquer' : 'Afficher';

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          required
          type={visible ? 'text' : 'password'}
          minLength={minLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 pr-11 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={onToggleVisibility}
          aria-label={`${action} ${label.toLowerCase()}`}
          title={`${action} ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-text-muted transition-colors hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {hint && <span className="block text-xs text-text-muted">{hint}</span>}
    </div>
  );
}

export function AuthPage({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [name, setName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (mode === 'register' && password !== passwordConfirmation) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

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
                setShowPassword(false);
                setShowPasswordConfirmation(false);
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
          <PasswordField
            id="password"
            label="Mot de passe"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : 1}
            visible={showPassword}
            onToggleVisibility={() => setShowPassword((current) => !current)}
            hint={mode === 'register' ? 'Au moins 8 caractères.' : undefined}
          />
          {mode === 'register' && (
            <PasswordField
              id="password-confirmation"
              label="Confirmation du mot de passe"
              value={passwordConfirmation}
              onChange={setPasswordConfirmation}
              autoComplete="new-password"
              minLength={8}
              visible={showPasswordConfirmation}
              onToggleVisibility={() => setShowPasswordConfirmation((current) => !current)}
            />
          )}
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
        Vos données sont isolées par organisation. Connectez vos comptes sociaux dès maintenant ;
        les modules IA et publication arrivent aux phases suivantes.
      </p>
    </main>
  );
}
