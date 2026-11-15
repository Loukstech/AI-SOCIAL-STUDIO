/**
 * Utilitaires de fuseau horaire (§11).
 *
 * Toutes les dates sont stockées en UTC. Le fuseau de l'organisation ne sert
 * qu'à l'affichage et à l'interprétation des saisies : il n'est jamais appliqué
 * au stockage, ce qui évite les doubles conversions.
 */

export function isKnownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Décalage du fuseau par rapport à UTC, en minutes, à l'instant donné. */
export function offsetMinutes(timezone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Représentation lisible d'un instant dans un fuseau, pour les libellés. */
export function formatInTimezone(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}
