import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Db } from '../common/validation.js';
import { ENV, type Env } from '../config/env.js';

const NOT_CONFIGURED_S3 = 'Stockage S3 non configuré (variables R2_* manquantes)';

/** Limite mémoire par requête, appliquée par multer avant tout traitement (§12). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface StoredFile {
  content: Buffer;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Stockage privé des fichiers de la médiathèque (§12).
 *
 * Deux pilotes :
 * - `database` (défaut) : les octets vont dans la table `MediaObject` de la base
 *   PostgreSQL déjà configurée. Aucun fournisseur ni carte bancaire supplémentaire.
 * - `s3` : compatible Cloudflare R2, gardé pour un branchement futur.
 *
 * Les URLs de lecture sont soit signées HMAC par cette API (database), soit
 * signées S3 (s3). Aucun fichier n'est jamais public de façon permanente.
 */
@Injectable()
export class ObjectStorageService {
  private readonly driver: 'database' | 's3';
  private readonly client: S3Client | null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(Db) private readonly db: Db,
  ) {
    this.driver = env.MEDIA_STORAGE_DRIVER;
    const { R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
    this.client =
      this.driver === 's3' &&
      R2_ENDPOINT &&
      R2_BUCKET_NAME &&
      R2_ACCESS_KEY_ID &&
      R2_SECRET_ACCESS_KEY
        ? new S3Client({
            region: env.R2_REGION,
            endpoint: R2_ENDPOINT,
            forcePathStyle: true,
            credentials: {
              accessKeyId: R2_ACCESS_KEY_ID,
              secretAccessKey: R2_SECRET_ACCESS_KEY,
            },
          })
        : null;
  }

  get configured(): boolean {
    return this.driver === 'database' ? Boolean(this.env.DATABASE_URL) : this.client !== null;
  }

  get maxUploadBytes(): number {
    return this.env.R2_MAX_UPLOAD_MB * 1024 * 1024;
  }

  /** Clé privée, préfixée par l'organisation pour rendre toute traversée impossible. */
  objectKey(organizationId: string, filename: string, assetId = randomUUID()): string {
    const safe = filename
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 120);
    return `org/${organizationId}/${assetId}/${safe || 'fichier'}`;
  }

  /** Refuse toute clé qui ne commence pas par le préfixe de l'organisation. */
  assertOrganizationKey(organizationId: string, key: string): void {
    const prefix = `org/${organizationId}/`;
    if (!key.startsWith(prefix) || key.includes('..') || key.includes('\\')) {
      throw new ServiceUnavailableException('Clé de fichier invalide');
    }
  }

  checksum(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  async put(key: string, content: Buffer, contentType: string): Promise<void> {
    const checksum = this.checksum(content);
    const mimeType = contentType || 'application/octet-stream';

    if (this.driver === 'database') {
      await this.db.client.mediaObject.upsert({
        where: { storageKey: key },
        create: {
          storageKey: key,
          data: Uint8Array.from(content),
          mimeType,
          sizeBytes: content.length,
          checksum,
        },
        update: {
          data: Uint8Array.from(content),
          mimeType,
          sizeBytes: content.length,
          checksum,
        },
      });
      return;
    }

    const client = this.requireClient();
    await client.send(
      new PutObjectCommand({
        Bucket: this.env.R2_BUCKET_NAME,
        Key: key,
        Body: content,
        ContentType: mimeType,
        Metadata: { checksum },
      }),
    );
  }

  /** Lit les octets pour la route publique signée. Réservé au pilote `database`. */
  async read(key: string): Promise<StoredFile | null> {
    if (this.driver !== 'database') return null;
    const row = await this.db.client.mediaObject.findUnique({
      where: { storageKey: key },
      select: { data: true, mimeType: true, sizeBytes: true, checksum: true },
    });
    if (!row) return null;
    return {
      content: Buffer.from(row.data),
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      checksum: row.checksum,
    };
  }

  /** URL de lecture temporaire. Le fichier reste privé en permanence. */
  async signedGetUrl(key: string, expiresIn?: number): Promise<{ url: string; expiresAt: string }> {
    const seconds = Math.min(
      Math.max(Math.floor(expiresIn ?? this.env.R2_SIGNED_TTL_SECONDS), 30),
      3600,
    );

    if (this.driver === 'database') {
      const exp = Math.floor(Date.now() / 1000) + seconds;
      const token = this.sign(key, exp);
      const base = this.publicBaseUrl();
      const query = new URLSearchParams({ key, exp: String(exp), token });
      return {
        url: `${base}/api/v1/media/file?${query.toString()}`,
        expiresAt: new Date(exp * 1000).toISOString(),
      };
    }

    const client = this.requireClient();
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.env.R2_BUCKET_NAME, Key: key }),
      { expiresIn: seconds },
    );
    return { url, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() };
  }

  /** Vérifie un lien HMAC local : clé, durée et signature. */
  verifySignedUrl(
    key: string | undefined,
    exp: string | undefined,
    token: string | undefined,
  ): void {
    if (
      !key ||
      !exp ||
      !token ||
      !key.startsWith('org/') ||
      key.includes('..') ||
      key.includes('\\')
    ) {
      throw new UnauthorizedException('Lien de fichier invalide');
    }

    const expiresAt = Number(exp);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(expiresAt) || expiresAt < now - 30 || expiresAt > now + 3630) {
      throw new UnauthorizedException('Lien de fichier expiré');
    }

    const expected = Buffer.from(this.sign(key, expiresAt), 'hex');
    const received = Buffer.from(token, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedException('Signature du lien invalide');
    }
  }

  /** Suppression best-effort : un objet déjà absent n'est pas une erreur. */
  async remove(key: string): Promise<void> {
    if (this.driver === 'database') {
      await this.db.client.mediaObject.deleteMany({ where: { storageKey: key } });
      return;
    }

    const client = this.requireClient();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: this.env.R2_BUCKET_NAME, Key: key }));
    } catch (cause) {
      const name = (cause as { name?: string })?.name;
      if (name !== 'NoSuchKey' && name !== 'NotFound') throw cause;
    }
  }

  private sign(key: string, expiresAt: number): string {
    if (!this.env.AUTH_SECRET) {
      throw new ServiceUnavailableException('AUTH_SECRET requis pour signer les fichiers');
    }
    return createHmac('sha256', this.env.AUTH_SECRET).update(`${key}|${expiresAt}`).digest('hex');
  }

  private publicBaseUrl(): string {
    const fallback = `http://localhost:${this.env.PORT ?? this.env.API_PORT}`;
    return (this.env.API_PUBLIC_URL ?? fallback).replace(/\/$/, '');
  }

  private requireClient(): S3Client {
    if (!this.client) throw new ServiceUnavailableException(NOT_CONFIGURED_S3);
    return this.client;
  }
}
