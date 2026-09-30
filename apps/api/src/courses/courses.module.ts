import { Module } from '@nestjs/common';
import { AdminCoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  controllers: [AdminCoursesController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
