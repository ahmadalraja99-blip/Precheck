import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'path';

@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService) {}

  root() {
    return resolve(this.config.get<string>('STORAGE_ROOT', 'storage'));
  }

  resolve(relativePath: string) {
    if (!relativePath || isAbsolute(relativePath)) throw new Error('Storage path must be relative');
    const root = this.root();
    const fullPath = resolve(root, relativePath);
    const fromRoot = relative(root, fullPath);
    if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new Error('Storage path escapes STORAGE_ROOT');
    }
    return fullPath;
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

  async saveAtomic(relativePath: string, data: Buffer) {
    const finalPath = this.resolve(relativePath);
    const temporaryPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(dirname(finalPath), { recursive: true });
    try {
      await writeFile(temporaryPath, data, { flag: 'wx' });
      await rename(temporaryPath, finalPath);
      const details = await stat(finalPath);
      if (!details.isFile()) throw new Error('Final report file was not created');
      return { relativePath, fullPath: finalPath, size: details.size };
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async assertFile(relativePath: string) {
    const fullPath = this.resolve(relativePath);
    const details = await stat(fullPath);
    if (!details.isFile()) throw new Error('Stored path is not a file');
    return { fullPath, size: details.size };
  }
}
