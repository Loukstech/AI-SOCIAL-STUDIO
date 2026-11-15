import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { PublicationsService } from './publications.service.js';

/**
 * Boucle de publication (§10.2).
 *
 * L'offre gratuite Render n'offre pas de worker séparé : la boucle tourne donc
 * dans le processus de l'API. `claimDue` s'appuie sur une écriture
 * conditionnelle pour qu'une seconde instance ne puisse pas renvoyer la même
 * publication.
 */
@Injectable()
export class PublishingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublishingScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PublicationsService) private readonly publications: PublicationsService,
  ) {}

  onModuleInit(): void {
    if (this.env.PUBLISH_SCHEDULER !== 'on') {
      this.logger.log('Boucle de publication désactivée (PUBLISH_SCHEDULER=off)');
      return;
    }
    const intervalMs = this.env.PUBLISH_TICK_SECONDS * 1000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // Ne bloque pas l'arrêt du processus, notamment pendant les tests.
    this.timer.unref();
    this.logger.log(`Boucle de publication active : toutes les ${this.env.PUBLISH_TICK_SECONDS}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.publications.claimDue();
      if (result.claimed > 0 || result.expired > 0) {
        this.logger.log(
          `Échéances traitées : ${result.claimed} envoyée(s), ${result.expired} expirée(s)`,
        );
      }
    } catch (error) {
      // Une base momentanément indisponible ne doit pas arrêter la boucle.
      this.logger.warn(
        `Tick de publication ignoré : ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
