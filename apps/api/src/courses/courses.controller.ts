import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CreateCourseInput, CreateItemInput, CreateSectionInput, UpdateCourseInput, UpdateItemInput, UpdateSectionInput,
  createCourseSchema, createItemSchema, createSectionSchema, reorderSchema, updateCourseSchema, updateItemSchema, updateSectionSchema,
} from '@ielts/validation';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Actor, CoursesService, MAX_CONTENT_FILE_BYTES } from './courses.service';

const uuid = new ParseUUIDPipe();
const createVersionSchema = z.object({ cloneFromVersionId: z.string().uuid().optional() });
const actor = (user: AuthUser, req: Request): Actor => ({ userId: user.id, ...clientMeta(req) });

@Controller('admin')
export class AdminCoursesController {
  constructor(private readonly courses: CoursesService) {}

  // the academy's one course
  @RequirePermission('course.view') @Get('course')
  main() { return this.courses.getMain(); }

  // courses
  @RequirePermission('course.view') @Get('courses')
  list() { return this.courses.listAdmin(); }

  @RequirePermission('course.view') @Get('courses/:id')
  get(@Param('id', uuid) id: string) { return this.courses.getAdmin(id); }

  @RequirePermission('course.create') @Post('courses')
  create(@Body(new ZodPipe(createCourseSchema)) body: CreateCourseInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.courses.create(body, actor(u, req));
  }

  @RequirePermission('course.edit') @Patch('courses/:id')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(updateCourseSchema)) body: UpdateCourseInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.courses.update(id, body, actor(u, req));
  }

  // versions
  @RequirePermission('course.edit') @Post('courses/:id/versions')
  createVersion(@Param('id', uuid) id: string, @Body(new ZodPipe(createVersionSchema)) body: { cloneFromVersionId?: string }, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.courses.createVersion(id, body.cloneFromVersionId, actor(u, req));
  }

  @RequirePermission('course.publish') @HttpCode(200) @Post('course-versions/:id/publish')
  publish(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.courses.publishVersion(id, actor(u, req));
  }

  @RequirePermission('course.view') @Get('course-versions/:id/tree')
  tree(@Param('id', uuid) id: string) { return this.courses.tree(id); }

  // sections
  @RequirePermission('content.manage') @Post('course-versions/:id/sections')
  createSection(@Param('id', uuid) id: string, @Body(new ZodPipe(createSectionSchema)) body: CreateSectionInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.courses.createSection(id, body, actor(u, req));
  }

  @RequirePermission('content.manage') @HttpCode(200) @Post('course-versions/:id/sections/reorder')
  reorderSections(@Param('id', uuid) id: string, @Body(new ZodPipe(reorderSchema)) body: { ids: string[] }, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.courses.reorderSections(id, body.ids, actor(u, req));
  }

  @RequirePermission('content.manage') @Patch('sections/:id')
  updateSection(@Param('id', uuid) id: string, @Body(new ZodPipe(updateSectionSchema)) body: UpdateSectionInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.courses.updateSection(id, body, actor(u, req));
  }

  @RequirePermission('content.manage') @HttpCode(204) @Delete('sections/:id')
  async deleteSection(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    await this.courses.deleteSection(id, actor(u, req));
  }

  // items
  @RequirePermission('content.manage') @Post('sections/:id/items')
  createItem(@Param('id', uuid) id: string, @Body(new ZodPipe(createItemSchema)) body: CreateItemInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.courses.createItem(id, body, actor(u, req));
  }

  @RequirePermission('content.manage') @HttpCode(200) @Post('sections/:id/items/reorder')
  reorderItems(@Param('id', uuid) id: string, @Body(new ZodPipe(reorderSchema)) body: { ids: string[] }, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.courses.reorderItems(id, body.ids, actor(u, req));
  }

  @RequirePermission('content.manage') @Patch('items/:id')
  updateItem(@Param('id', uuid) id: string, @Body(new ZodPipe(updateItemSchema)) body: UpdateItemInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.courses.updateItem(id, body, actor(u, req));
  }

  @RequirePermission('content.manage') @HttpCode(201) @Post('items/:id/file')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_CONTENT_FILE_BYTES, files: 1 } }))
  attachFile(@Param('id', uuid) id: string, @UploadedFile() file: { buffer: Buffer; size: number; originalname: string } | undefined, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.courses.attachFile(id, file, actor(u, req));
  }

  @RequirePermission('content.manage') @HttpCode(204) @Delete('items/:id')
  async deleteItem(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    await this.courses.deleteItem(id, actor(u, req));
  }
}

