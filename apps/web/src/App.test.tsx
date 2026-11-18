import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { session, setSessionToken } from './lib/api';

beforeEach(() => {
  session.clear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  window.location.hash = '';
  window.localStorage.removeItem('ass.sidebar.collapsed');
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('affiche l’écran de connexion quand aucune session n’existe', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'AI Social Studio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer un compte' })).toBeInTheDocument();
  });

  it('permet de basculer vers la création de compte', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer un compte' }));
    expect(screen.getByText('Votre nom')).toBeInTheDocument();
    expect(screen.getByText('Confirmation du mot de passe')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer mon espace' })).toBeInTheDocument();
  });

  it('affiche et masque les mots de passe avec un bouton œil', () => {
    render(<App />);

    const password = screen.getByLabelText('Mot de passe');
    expect(password).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Afficher mot de passe' }));
    expect(password).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Masquer mot de passe' }));
    expect(password).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Créer un compte' }));
    const confirmation = screen.getByLabelText('Confirmation du mot de passe');
    expect(confirmation).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Afficher confirmation du mot de passe' }));
    expect(confirmation).toHaveAttribute('type', 'text');
  });

  it('refuse une confirmation de mot de passe différente', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer un compte' }));

    fireEvent.change(screen.getByLabelText('Votre nom'), {
      target: { value: 'Loukstech' },
    });
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
      target: { value: 'loukstech@gmail.com' },
    });
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'motdepasse123' },
    });
    fireEvent.change(screen.getByLabelText('Confirmation du mot de passe'), {
      target: { value: 'autremotdepasse123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon espace' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Les mots de passe ne correspondent pas.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('affiche le vrai message du serveur quand les identifiants sont incorrects', async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 401,
      ok: false,
      json: async () => ({ message: 'Identifiants incorrects' }),
    } as Response);
    render(<App />);

    fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
      target: { value: 'loukstech@gmail.com' },
    });
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'mauvais-mot-de-passe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Identifiants incorrects'),
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('Session expirée');
  });

  it('vérifie la session existante avant d’afficher le tableau de bord', () => {
    setSessionToken('jeton-de-test');
    render(<App />);
    expect(screen.getByText('Vérification de la session…')).toBeInTheDocument();
  });

  it('affiche une landing publique sans session via #landing', () => {
    window.location.hash = '#landing';
    render(<App />);
    expect(
      screen.getByRole('heading', { name: /De l'idée à la campagne multiréseaux/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: "Ouvrir l'application" })[0]!);
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
  });

  it('permet de réduire et de déployer la navigation latérale', async () => {
    const json = (data: unknown) => ({ status: 200, ok: true, json: async () => data }) as Response;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/auth/me')) {
        return json({
          id: 'user-1',
          email: 'test@example.com',
          name: 'Test',
          createdAt: new Date().toISOString(),
          isSuperAdmin: false,
        });
      }
      if (url.includes('/organizations')) return json([]);
      if (url.includes('/notifications/unread')) return json({ unread: 0 });
      if (url.includes('/dashboard')) {
        return json({
          organizations: 1,
          brands: 1,
          media: 1,
          members: 1,
          pendingInvitations: 0,
          videoProjects: 0,
          contentProjects: 0,
          publications: 0,
          scheduledPublications: 0,
          imageProjects: 0,
          recentActivity: [],
        });
      }
      return json({});
    });

    setSessionToken('jeton-de-test');
    render(<App />);

    await screen.findByRole('heading', { name: 'Tableau de bord' });
    fireEvent.click(screen.getByRole('button', { name: 'Réduire la navigation' }));
    expect(screen.getByRole('button', { name: 'Déployer la navigation' })).toBeInTheDocument();
    expect(window.localStorage.getItem('ass.sidebar.collapsed')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Déployer la navigation' }));
    expect(screen.getByRole('button', { name: 'Réduire la navigation' })).toBeInTheDocument();
  });
});
