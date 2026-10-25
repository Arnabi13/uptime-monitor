import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { QueryFailedError } from 'typeorm';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { LoginDto, RegisterDto } from './dto/credentials.dto';
import { JwtPayload } from './jwt.strategy';

const BCRYPT_ROUNDS = 12;
const PG_UNIQUE_VIOLATION = '23505';

export interface AuthResponse {
  accessToken: string;
  user: { id: string; email: string };
}

@Injectable()
export class AuthService {
  // Compared against when the email doesn't exist, so "unknown email" and
  // "wrong password" take the same time and can't be told apart by timing.
  private readonly dummyHash = bcrypt.hashSync('timing-equaliser', BCRYPT_ROUNDS);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    try {
      const user = await this.users.create(dto.email, passwordHash);
      return this.issueToken(user);
    } catch (err) {
      // Rely on the DB unique constraint instead of "check then insert",
      // which has a race when two sign-ups for one email arrive together.
      if (err instanceof QueryFailedError && (err as any).driverError?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('An account with this email already exists');
      }
      throw err;
    }
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.users.findByEmailWithPassword(dto.email);
    const passwordOk = await bcrypt.compare(dto.password, user?.passwordHash ?? this.dummyHash);
    if (!user || !passwordOk) {
      // Same message for both cases: don't reveal which emails are registered.
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueToken(user);
  }

  private async issueToken(user: User): Promise<AuthResponse> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: { id: user.id, email: user.email },
    };
  }
}
