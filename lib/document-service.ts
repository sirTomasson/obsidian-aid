import {ObsidianSearchEngine} from './search-engine';
import {Document, DocumentChunk, DocumentChunkParams, documentOk, TFileLike} from './core';
import {TAbstractFile} from 'obsidian';
import {Embeddings, Options as EmbeddingsOptions} from './embeddings';
import {any} from './utils';

export interface Task {

}

export interface DocumentService {
  sync(tfile: TAbstractFile[]): Promise<Task>;

  create(tfile: TAbstractFile): Promise<void>;

  createAll(tfile: TAbstractFile[]): Promise<void>;

  delete(tfile: TAbstractFile): Promise<void>;

  deleteBy<V = unknown>(value: V, property: string): Promise<void>;

  deleteAll(tfile: TAbstractFile[]): Promise<void>;

  update(tfile: TAbstractFile): Promise<void>;

  healthy(): Promise<boolean>;

  createIndex(): Promise<boolean>;

  move(oldPath: string, file: TAbstractFile): Promise<void>;
}

interface DocumentServiceConfig {
  chunkSize: number;
  chunkOverlap: number;
  vaultRoot: string;
  embeddingsOptions?: EmbeddingsOptions;
}

export class ObsidianDocumentService implements DocumentService {

  constructor(private searchEngine: ObsidianSearchEngine<DocumentChunk>,
              private config: DocumentServiceConfig) {
  }

  async sync(tfiles: TAbstractFile[]): Promise<Task> {
    await this.deleteNonLocalFiles(tfiles);

    for (const file of tfiles) {
      const exists = await this.fileExists(file);
      if (exists) continue;

      await this.create(file);
    }
    return {};
  }

  async create(tfile: TAbstractFile): Promise<void> {
    await this.createAll([tfile]);
  }

  async createAll(tfiles: TAbstractFile[]): Promise<void> {
    const documentChunks = await this.chunk(tfiles);
    const chunksEmbeddings = await Embeddings.fromDocumentChunks(documentChunks, this.config.embeddingsOptions);
    await this.searchEngine.add(chunksEmbeddings);
  }

  async delete(tfile: TAbstractFile): Promise<void> {
    await this.deleteAll([tfile]);
  }

  async deleteAll(tfiles: TAbstractFile[]): Promise<void> {
    const paths: string[] = tfiles.map(tfile => tfile.path);
    await this.searchEngine.deleteBy(paths, 'metadata.path');
  }

  async deleteBy<V = unknown>(value: V, property: string): Promise<void> {
    return this.searchEngine.deleteBy(value, property);
  }

  async update(tfile: TAbstractFile): Promise<void> {
    this.delete(tfile);
    this.create(tfile);
  }

  private async chunk(tAbstractFiles: TAbstractFile[]): Promise<DocumentChunk[]> {
    const chunks = tAbstractFiles
      .flatMap(tAbstractFile => toTFileLike(tAbstractFile))
      .map(async tfile => await chunk(tfile, this.config.vaultRoot, {
        chunkSize: this.config.chunkSize,
        chunkOverlap: this.config.chunkOverlap
      }));

    return (await Promise.all(chunks)).flat();
  }

  async healthy(): Promise<boolean> {
    return this.searchEngine.healthy();
  }

  async createIndex(): Promise<boolean> {
    return this.searchEngine.createIndex();
  }

  async move(oldPath: string, file: TAbstractFile): Promise<void> {
    const documentChunks = await this.searchEngine.findBy(oldPath, 'metadata.path');
    if (documentChunks.length < 0) {
      console.error(`Could not find document by ${oldPath}`);
      return;
    }
    const updatedChunks = documentChunks.map(documentChunk => {
      documentChunk.metadata.path = file.path;
      return documentChunk;
    });
    await this.searchEngine.add(updatedChunks);
  }

  /** Deletes all non local files */
  private async deleteNonLocalFiles(tfiles: TAbstractFile[]) {
    const allPaths = tfiles.map(tfile => `"${tfile.path}"`).join(', ');
    const filter = `metadata.path NOT IN [${allPaths}]`;
    await this.searchEngine.deleteByFilter(filter);
  }

  private async fileExists(tfile: TAbstractFile): Promise<boolean> {
    const result = await this.searchEngine.findBy(tfile.path, 'metadata.path');
    return any(result);
  }
}

function toTFileLike(tfile: TAbstractFile): TFileLike {
  if (tfile.name.endsWith('.md')) {
    return {
      path: tfile.path,
      name: tfile.name,
      extension: 'md'
    };
  }
  throw new Error('unsupported extension');
}

async function chunk(tfile: TFileLike, vaultRoot: string, config: DocumentChunkParams) {
  const documents = (await Document.fromTFiles([tfile], vaultRoot))
    .filter(documentOk);
  return DocumentChunk.fromDocuments(documents, config);
}
