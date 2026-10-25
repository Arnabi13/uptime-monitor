import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  /** Includes the password hash (excluded by default via select: false). Only auth should call this. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: UsersService.normalizeEmail(email) })
      .getOne();
  }

  create(email: string, passwordHash: string): Promise<User> {
    const user = this.users.create({ email: UsersService.normalizeEmail(email), passwordHash });
    return this.users.save(user);
  }
}
