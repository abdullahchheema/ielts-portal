import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';

/** Authentication (login, sessions, password reset, 2FA). Exported so other modules can start sessions. */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, MfaService],
  exports: [AuthService, MfaService],
})
export class AuthModule {}
