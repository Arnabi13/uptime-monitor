import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/jwt.strategy';
import { PublicStatusPage, StatusPageService, StatusPageSettings } from './status-page.service';

export class UpdateStatusPageDto {
  @IsString()
  @MaxLength(80)
  title: string;
}

/** The owner's view: see / rename / rotate their status page link. */
@Controller('status-page')
@UseGuards(JwtAuthGuard)
export class StatusPageController {
  constructor(private readonly statusPages: StatusPageService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<StatusPageSettings> {
    return this.statusPages.settings(user.userId);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateStatusPageDto): Promise<StatusPageSettings> {
    return this.statusPages.updateTitle(user.userId, dto.title);
  }

  @Post('rotate')
  @HttpCode(HttpStatus.OK)
  rotate(@CurrentUser() user: AuthUser): Promise<StatusPageSettings> {
    return this.statusPages.rotateSlug(user.userId);
  }
}

/** Anyone with the link. No auth guard on purpose. */
@Controller('public/status')
export class PublicStatusController {
  constructor(private readonly statusPages: StatusPageService) {}

  @Get(':slug')
  // Lets the browser — and CloudFront on Day 4 — reuse a response for 30s.
  // If a status page link goes viral, most requests never reach EC2 at all.
  @Header('Cache-Control', 'public, max-age=30')
  get(@Param('slug') slug: string): Promise<PublicStatusPage> {
    return this.statusPages.publicPage(slug);
  }
}
