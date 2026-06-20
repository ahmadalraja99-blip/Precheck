import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService) {}

  root() {
    return this.config.get<string>('STORAGE_ROOT', 'storage');
  }

  resolve(relativePath: string) {
    return join(this.root(), relativePath);
  }

  async save(relativePath: string, data: Buffer | string) {
    const fullPath = this.resolve(relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
    return relativePath;
  }

  read(relativePath: string) {
    return readFile(this.resolve(relativePath));
  }
}
