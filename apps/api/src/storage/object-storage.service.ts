import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ENV, type Env } from '../config/env.js';

const NOT_CONFIGURED = 'Stockage objet non configuré (Variables R2_* manquantes)';

/** Limite mémoire par requête, appliquée par multer avant tout traitement (§12). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Stockage objet S3-compatible (§12). Le binaire ne passe jamais par PostgreSQL :
 * la base ne garde que `MediaAsset.storageKey`.
 *
 * Sans configuration complète, le service est désactivé et les routes qui en
 * dépendent répondent 503. On ne renvoie jamais d'URL factice ou de lien public
 * permanent pour un fichier privé.
 */
@Injectable()
export class ObjectStorageService {
  private readonly client: S3Client | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    const { R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
    this.client =
      R2_ENDPOINT && R2_BUCKET_NAME && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY
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
    return this.client !== null;
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
    const client = this.requireClient();
    await client.send(
      new PutObjectCommand({
        Bucket: this.env.R2_BUCKET_NAME,
        Key: key,
        Body: content,
        ContentType: contentType || 'application/octet-stream',
        Metadata: { checksum: this.checksum(content) },
      }),
    );
  }

  /** URL de lecture temporaire. Le fichier reste privé en permanence. */
  async signedGetUrl(key: string, expiresIn?: number): Promise<{ url: string; expiresAt: string }> {
    const client = this.requireClient();
    const seconds = Math.min(
      Math.max(Math.floor(expiresIn ?? this.env.R2_SIGNED_TTL_SECONDS), 30),
      3600,
    );
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.env.R2_BUCKET_NAME, Key: key }),
      { expiresIn: seconds },
    );
    return { url, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() };
  }

  /** Suppression best-effort : un objet déjà absent n'est pas une erreur. */
  async remove(key: string): Promise<void> {
    const client = this.requireClient();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: this.env.R2_BUCKET_NAME, Key: key }));
    } catch (cause) {
      const name = (cause as { name?: string })?.name;
      if (name !== 'NoSuchKey' && name !== 'NotFound') throw cause;
    }
  }

  private requireClient(): S3Client {
    if (!this.client) throw new ServiceUnavailableException(NOT_CONFIGURED);
    return this.client;
  }
}
