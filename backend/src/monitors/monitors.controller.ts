import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/jwt.strategy';
import { Incident } from '../incidents/incident.entity';
import { CreateMonitorDto, HistoryQueryDto, UpdateMonitorDto } from './dto/monitor.dto';
import {
  HistoryBucket,
  MonitorOverview,
  MonitorStats,
  MonitorStatsService,
} from './monitor-stats.service';
import { Monitor } from './monitor.entity';
import { MonitorsService } from './monitors.service';

@Controller('monitors')
@UseGuards(JwtAuthGuard)
export class MonitorsController {
  constructor(
    private readonly monitors: MonitorsService,
    private readonly stats: MonitorStatsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<Monitor[]> {
    return this.monitors.list(user.userId);
  }

  /**
   * Uptime + recent checks for every monitor in one request, so the dashboard
   * doesn't fire one request per row (the N+1 problem, but over HTTP).
   * Declared before ':id' so "overview" isn't parsed as an id.
   */
  @Get('overview')
  async overview(@CurrentUser() user: AuthUser): Promise<MonitorOverview[]> {
    const mine = await this.monitors.list(user.userId);
    return this.stats.overview(mine.map((m) => m.id));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMonitorDto): Promise<Monitor> {
    return this.monitors.create(user.userId, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Monitor> {
    return this.monitors.findOne(user.userId, id);
  }

  @Get(':id/stats')
  async monitorStats(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MonitorStats> {
    await this.monitors.findOne(user.userId, id); // 404 unless it's yours
    return this.stats.stats(id);
  }

  @Get(':id/history')
  async history(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: HistoryQueryDto,
  ): Promise<HistoryBucket[]> {
    await this.monitors.findOne(user.userId, id);
    return this.stats.history(id, query.range ?? '24h');
  }

  @Get(':id/incidents')
  async incidents(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Incident[]> {
    await this.monitors.findOne(user.userId, id);
    return this.stats.listIncidents(id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMonitorDto,
  ): Promise<Monitor> {
    return this.monitors.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.monitors.remove(user.userId, id);
  }
}
