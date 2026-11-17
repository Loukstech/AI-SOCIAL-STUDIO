-- Le §12 distingue aussi logos, projets et exports des médias génériques.
ALTER TYPE "MediaKind" ADD VALUE IF NOT EXISTS 'LOGO';
ALTER TYPE "MediaKind" ADD VALUE IF NOT EXISTS 'PROJECT';
ALTER TYPE "MediaKind" ADD VALUE IF NOT EXISTS 'EXPORT';
