import { describe, expect, it } from 'vitest';
import {
  MAX_PUBLISH_ATTEMPTS,
  canTransition,
  publicationStatuses,
  publicationTransitions,
  terminalStatuses,
} from '@ass/shared';

/**
 * Le circuit §10.3 est la règle métier centrale du Publishing Center :
 * ces tests le verrouillent entièrement, y compris les mouvements interdits.
 */

describe('circuit de publication', () => {
  it('déclare une liste de transitions pour chaque état', () => {
    for (const status of publicationStatuses) {
      expect(publicationTransitions[status]).toBeDefined();
    }
  });

  it('ne référence que des états connus', () => {
    for (const status of publicationStatuses) {
      for (const next of publicationTransitions[status]) {
        expect(publicationStatuses).toContain(next);
      }
    }
  });

  it('suit le chemin nominal du cahier des charges', () => {
    const path = [
      'DRAFT',
      'READY_FOR_REVIEW',
      'PENDING_APPROVAL',
      'APPROVED',
      'SCHEDULED',
      'PUBLISHING',
      'PUBLISHED',
    ] as const;
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index]!;
      const to = path[index + 1]!;
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('autorise les états complémentaires', () => {
    expect(canTransition('PENDING_APPROVAL', 'REJECTED')).toBe(true);
    expect(canTransition('SCHEDULED', 'CANCELLED')).toBe(true);
    expect(canTransition('PUBLISHING', 'FAILED')).toBe(true);
    expect(canTransition('SCHEDULED', 'EXPIRED')).toBe(true);
  });

  it('refuse de sauter la validation', () => {
    expect(canTransition('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransition('DRAFT', 'SCHEDULED')).toBe(false);
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false);
    expect(canTransition('READY_FOR_REVIEW', 'PUBLISHING')).toBe(false);
    expect(canTransition('APPROVED', 'PUBLISHED')).toBe(false);
    expect(canTransition('PENDING_APPROVAL', 'SCHEDULED')).toBe(false);
  });

  it('refuse de revenir en arrière depuis un état publié', () => {
    expect(publicationTransitions.PUBLISHED).toEqual([]);
    expect(canTransition('PUBLISHED', 'DRAFT')).toBe(false);
    expect(canTransition('PUBLISHED', 'CANCELLED')).toBe(false);
  });

  it('refuse de renvoyer une publication en cours d’envoi', () => {
    expect(canTransition('PUBLISHING', 'SCHEDULED')).toBe(false);
    expect(canTransition('PUBLISHING', 'DRAFT')).toBe(false);
  });

  it('permet de repartir d’un échec', () => {
    expect(canTransition('FAILED', 'PUBLISHING')).toBe(true);
    expect(canTransition('FAILED', 'SCHEDULED')).toBe(true);
    expect(canTransition('FAILED', 'DRAFT')).toBe(true);
    expect(canTransition('EXPIRED', 'SCHEDULED')).toBe(true);
    expect(canTransition('REJECTED', 'DRAFT')).toBe(true);
  });

  it('n’autorise l’échec vers publié que pour la confirmation manuelle', () => {
    // Seule la confirmation manuelle (URL par cible) emprunte cette arête :
    // l'état FAILED ne saute pas l'envoi par une autre route.
    expect(canTransition('FAILED', 'PUBLISHED')).toBe(true);
    expect(publicationTransitions.FAILED).toContain('PUBLISHED');
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false);
  });

  it('ne se contredit pas : aucune transition vers soi-même', () => {
    for (const status of publicationStatuses) {
      expect(publicationTransitions[status]).not.toContain(status);
    }
  });

  it('marque comme terminaux les seuls états publiés et annulés', () => {
    expect(terminalStatuses).toEqual(['PUBLISHED', 'CANCELLED']);
  });

  it('borne le nombre de tentatives', () => {
    expect(MAX_PUBLISH_ATTEMPTS).toBe(3);
  });
});
