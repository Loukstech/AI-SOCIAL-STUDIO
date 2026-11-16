import { useCallback, useEffect, useState } from 'react';

/**
 * Chargement d'une ressource distante, avec rechargement explicite.
 *
 * Le corps de l'effet ne pose **jamais** d'état de façon synchrone : il lance la
 * promesse et n'écrit qu'à la résolution. C'est la règle que le compilateur
 * React impose, et elle a un sens ici — un `setState` synchrone dans un effet
 * provoque un rendu en cascade à chaque montage.
 *
 * `reload` sert après une action (commenter, terminer une tâche) : on relit la
 * vérité du serveur plutôt que de rafistoler l'état local.
 */
export function useAsyncData<T>(fetcher: () => Promise<T>): {
  data: T | null;
  error: string;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    void fetcher()
      .then((result) => {
        if (!active) return;
        setData(result);
        setError('');
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Chargement impossible');
      });
    return () => {
      active = false;
    };
  }, [fetcher, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  return { data, error, reload };
}
