import { Module } from '@nestjs/common';
import { BatchesModule } from '../batches/batches.module';
import { AdminTeacherApplicationsController, AdminTeachersController, TeacherApplicationsController } from './teachers.controller';
import { TeachersService } from './teachers.service';

@Module({
  imports: [BatchesModule],
  controllers: [TeacherApplicationsController, AdminTeacherApplicationsController, AdminTeachersController],
  providers: [TeachersService],
  exports: [TeachersService],
})
export class TeachersModule {}
