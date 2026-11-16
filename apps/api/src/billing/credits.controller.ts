import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import {
  creditAccountSchema,
  creditLedgerSchema,
  creditOperationSchema,
  reserveCreditsSchema,
  settleCreditsSchema,
  type CreditAccount,
  type CreditLedger,
  type CreditOperation,
  type ReserveCreditsInput,
  type SettleCreditsInput,
} from '@ass/shared';
import { AuthGuard, MinRole } from '../auth/auth.guard.js';
import type { AuthedRequest } from '../auth/auth.types.js';
import { SuperAdminGuard } from '../admin/super-admin.guard.js';
import { ZodPipe } from '../common/validation.js';
import { CreditsService } from './credits.service.js';

@Controller('credits')
@UseGuards(AuthGuard)
export class CreditsController {
  constructor(@Inject(CreditsService) private readonly service: CreditsService) {}

  @Get('account')
  @MinRole('VIEWER')
  async account(@Req() request: AuthedRequest): Promise<CreditAccount> {
    return creditAccountSchema.parse(await this.service.account(request.auth!.organizationId));
  }

  @Get('ledger')
  @MinRole('VIEWER')
  async ledger(@Req() request: AuthedRequest): Promise<CreditLedger> {
    return creditLedgerSchema.parse(await this.service.ledger(request.auth!.organizationId));
  }

  @Post('reserve')
  @MinRole('EDITOR')
  async reserve(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(reserveCreditsSchema)) body: ReserveCreditsInput,
  ): Promise<CreditOperation> {
    return creditOperationSchema.parse(
      await this.service.reserve(request.auth!.organizationId, body, request.auth!.userId),
    );
  }

  @Post('confirm')
  @MinRole('EDITOR')
  async confirm(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(settleCreditsSchema)) body: SettleCreditsInput,
  ): Promise<CreditOperation> {
    return creditOperationSchema.parse(await this.service.confirm(body, request.auth!.userId));
  }

  @Post('refund')
  @MinRole('EDITOR')
  async refund(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(settleCreditsSchema)) body: SettleCreditsInput,
  ): Promise<CreditOperation> {
    return creditOperationSchema.parse(await this.service.refund(body, request.auth!.userId));
  }

  /** Octroi manuel : réservé à l'administration plateforme (§17). */
  @Post('grant')
  @UseGuards(SuperAdminGuard)
  async grant(
    @Req() request: AuthedRequest,
    @Body(new ZodPipe(reserveCreditsSchema)) body: ReserveCreditsInput,
  ): Promise<CreditOperation> {
    return creditOperationSchema.parse(
      await this.service.grant(request.auth!.organizationId, body, request.auth!.userId),
    );
  }
}
