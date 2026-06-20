import { Module } from '@nestjs/common';
import { CheckItemsController } from './check-items.controller';
import { CheckItemsService } from './check-items.service';

@Module({ controllers: [CheckItemsController], providers: [CheckItemsService], exports: [CheckItemsService] })
export class CheckItemsModule {}
