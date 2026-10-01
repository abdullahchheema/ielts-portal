import { Module } from '@nestjs/common';
import { BatchesModule } from '../batches/batches.module';
import {
  AdminTeacherApplicationsController, AdminTeachersController, PublicTeacherApplicationsController, TeacherApplicationDocumentsController,
} from './teachers.controller';
import { TeachersService } from './teachers.service';

@Module({
  imports: [BatchesModule],
  controllers: [PublicTeacherApplicationsController, TeacherApplicationDocumentsController, AdminTeacherApplicationsController, AdminTeachersController],
  providers: [TeachersService],
  exports: [TeachersService],
})
export class TeachersModule {}
