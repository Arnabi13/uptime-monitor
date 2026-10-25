import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';

export interface JwtPayload {
  sub: string; // user id
  email: string;
}

/** What controllers receive via @CurrentUser(). */
export interface AuthUser {
  userId: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'], // never accept "alg: none" or an unexpected algorithm
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    // A valid signature isn't enough if the account was deleted after the token was issued.
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return { userId: user.id, email: user.email };
  }
}
