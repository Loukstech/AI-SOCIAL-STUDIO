import type { HealthResponse } from '@ass/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const health: HealthResponse = {
  status: 'degraded',
  version: '0.0.0',
  environment: 'test',
  uptimeSeconds: 3,
  timestamp: '2026-11-13T10:00:00.000Z',
  dependencies: { database: 'up', redis: 'not_configured' },
};

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  it("affiche l'état réel de chaque dépendance", async () => {
    mockFetch(async () => Response.json(health));
    render(<App />);

    expect(screen.getByText(/Interrogation de l'API/)).toBeInTheDocument();
    expect(await screen.findByText('Non configuré')).toBeInTheDocument();
    expect(screen.getAllByText('Opérationnel')).toHaveLength(2); // API + PostgreSQL
  });

  it("affiche une erreur explicite quand l'API ne répond pas", async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    render(<App />);

    expect(await screen.findByText('API injoignable')).toBeInTheDocument();
    expect(screen.queryByText('Opérationnel')).not.toBeInTheDocument();
  });

  it('traite une réponse au format inattendu comme une erreur', async () => {
    mockFetch(async () => Response.json({ status: 'ok' }));
    render(<App />);

    expect(await screen.findByText('API injoignable')).toBeInTheDocument();
  });
});
