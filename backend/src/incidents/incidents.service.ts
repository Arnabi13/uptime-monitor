import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Incident } from './incident.entity';

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident)
    private readonly incidents: Repository<Incident>,
  ) {}

  findOpen(monitorId: string): Promise<Incident | null> {
    return this.incidents.findOne({ where: { monitorId, resolvedAt: IsNull() } });
  }

  open(monitorId: string, cause: string): Promise<Incident> {
    return this.incidents.save(this.incidents.create({ monitorId, cause, resolvedAt: null }));
  }

  async resolve(incident: Incident): Promise<void> {
    incident.resolvedAt = new Date();
    await this.incidents.save(incident);
  }
}
