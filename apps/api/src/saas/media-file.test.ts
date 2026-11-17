import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MediaFileController } from './media-file.controller.js';
import type { ObjectStorageService } from '../storage/object-storage.service.js';

function responseStub() {
  const headers = new Map<string, string>();
  let status = 0;
  let body: Buffer | undefined;
  const response = {
    status: (value: number) => {
      status = value;
      return response;
    },
    setHeader: (name: string, value: string) => headers.set(name, value),
    end: (value: Buffer) => {
      body = value;
      return response;
    },
  };
  return {
    response: response as never,
    headers,
    getStatus: () => status,
    getBody: () => body,
  };
}

describe('URL signée de fichier privé (§12)', () => {
  it('vérifie le lien puis renvoie les octets avec le bon type', async () => {
    const content = Buffer.from('image binaire');
    const verify = vi.fn();
    const read = vi.fn().mockResolvedValue({
      content,
      mimeType: 'image/png',
      sizeBytes: content.length,
      checksum: 'abc',
    });
    const storage = { verifySignedUrl: verify, read } as unknown as ObjectStorageService;
    const controller = new MediaFileController(storage);
    const res = responseStub();

    await controller.download('org/org-1/id/visuel.png', '123', 'signature', res.response);

    expect(verify).toHaveBeenCalledWith('org/org-1/id/visuel.png', '123', 'signature');
    expect(read).toHaveBeenCalledWith('org/org-1/id/visuel.png');
    expect(res.getStatus()).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Content-Length')).toBe(String(content.length));
    expect(res.headers.get('Content-Disposition')).toContain('visuel.png');
    expect(res.getBody()?.equals(content)).toBe(true);
  });

  it('ne lit aucun octet quand la signature est refusée', async () => {
    const verify = vi.fn(() => {
      throw new UnauthorizedException('Signature du lien invalide');
    });
    const read = vi.fn();
    const storage = { verifySignedUrl: verify, read } as unknown as ObjectStorageService;
    const controller = new MediaFileController(storage);
    const res = responseStub();

    await expect(
      controller.download(undefined, undefined, undefined, res.response),
    ).rejects.toThrow('Signature du lien invalide');
    expect(read).not.toHaveBeenCalled();
  });
});
