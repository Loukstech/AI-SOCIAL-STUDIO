import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { session, setSessionToken } from './lib/api';

beforeEach(() => {
  session.clear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  window.location.hash = '';
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
});
