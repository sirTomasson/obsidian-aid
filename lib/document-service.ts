import {ObsidianSearchEngine} from "./search-engine";
import {Document, DocumentChunk, DocumentChunkParams, documentOk, TFileLike} from "./core";
import {TAbstractFile } from "obsidian";

export interface DocumentService {
	create(tfile: TAbstractFile): Promise<void>;
	createAll(tfile: TAbstractFile[]): Promise<void>;
	delete(tfile: TAbstractFile): Promise<void>;
	deleteBy<V = unknown>(value: V, property: string): Promise<void>;
	deleteAll(tfile: TAbstractFile[]): Promise<void>;
	update(tfile: TAbstractFile): Promise<void>;
	healthy(): Promise<boolean>;
	resetIndex(): Promise<boolean>;
	move(oldPath: string, file: TAbstractFile): Promise<void>;
}

interface DocumentServiceConfig {
	chunkSize: number;
	chunkOverlap: number;
	vaultRoot: string;
}

export class ObsidianDocumentService implements DocumentService {

	constructor(private searchEngine: ObsidianSearchEngine<DocumentChunk>,
							private config: DocumentServiceConfig) { }

	async create(tfile: TAbstractFile): Promise<void> {
		await this.createAll([tfile]);
	}

	async createAll(tfiles: TAbstractFile[]): Promise<void> {
		const documentChunks = await this.chunk(tfiles);
		await this.searchEngine.add(documentChunks);
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
		await this.delete(tfile);
		await this.create(tfile);
	}

	private async chunk(tAbstractFiles: TAbstractFile[]): Promise<DocumentChunk[]> {
		const chunks = tAbstractFiles
			.flatMap(tAbstractFile => toTFileLike(tAbstractFile))
			.map(async tfile => await chunk(tfile, this.config.vaultRoot, {
				chunkSize: this.config.chunkSize,
				chunkOverlap: this.config.chunkOverlap,
			}));

		return (await Promise.all(chunks)).flat();
	}

	async healthy(): Promise<boolean> {
		return this.searchEngine.healthy()
	}

	async resetIndex(): Promise<boolean> {
		return this.searchEngine.reset();
	}

	async move(oldPath: string, file: TAbstractFile): Promise<void> {
		await this.searchEngine.deleteBy(oldPath, 'metadata.path');
		await this.create(file);
	}
}

function toTFileLike(tfile: TAbstractFile): TFileLike {
	if (tfile.name.endsWith('.md')) {
		return {
			path: tfile.path,
			name: tfile.name,
			extension: 'md'
		}
	}
	throw new Error('unsupported extension')
}

async function chunk(tfile: TFileLike, vaultRoot: string, config: DocumentChunkParams) {
	const documents = (await Document.fromTFiles([tfile], vaultRoot))
		.filter(documentOk);
	return DocumentChunk.fromDocuments(documents, config)
}
