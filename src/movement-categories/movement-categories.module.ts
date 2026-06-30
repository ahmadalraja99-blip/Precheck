import { Module } from '@nestjs/common';
import { MovementCategoriesController } from './movement-categories.controller';
import { MovementCategoriesService } from './movement-categories.service';

@Module({
  controllers: [MovementCategoriesController],
  providers: [MovementCategoriesService],
  exports: [MovementCategoriesService],
})
export class MovementCategoriesModule {}
