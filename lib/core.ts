import {DocumentInterface} from "@langchain/core/documents";
import {TFile} from "obsidian";
import {v4 as uuidv4} from 'uuid';
import fs from "node:fs/promises";
import path from 'path';
import {RecursiveCharacterTextSplitter} from "@langchain/textsplitters";
import assert from "node:assert";

export enum DocumentStatus {
	DELETED,
	NEW,
	INDEXED
}

interface DocumentMetaData extends Record<string, unknown> {
	filename: string;
	path: string;
	extension: 'md';
}

interface Loc {
	lines: { from: number; to: number };
}

interface DocumentChunkMetaData extends Record<string, unknown> {
	documentId?: string,
	filename: string;
	path: string;
	extension: 'md'
	loc: Loc;
}

export type DocumentChunkParams = {
	chunkSize: number,
	chunkOverlap: number
}

export class DocumentChunk implements DocumentInterface<DocumentChunkMetaData> {
	static async fromDocuments(documents: DocumentInterface<DocumentMetaData>[], params: DocumentChunkParams): Promise<DocumentChunk[]> {
		const textSplitter = new RecursiveCharacterTextSplitter(params)

		const documentSplits = documents
			.map(async (document) => {
				assert(document.id, 'document.id undefined')
			return DocumentChunk.fromSplit(await textSplitter.splitDocuments([document]), document.id)
		});

		return (await Promise.all(documentSplits)).flat();
	}

	private static fromSplit(documentSplits: DocumentInterface[], documentId: string) {

		return documentSplits.map(documentSplit => {
			const id = uuidv4()

			return new DocumentChunk(id,
				documentSplit.pageContent,
				{
					documentId,
					filename: documentSplit.metadata['filename'],
					path: documentSplit.metadata['path'],
					extension: documentSplit.metadata['extension'],
					loc: documentSplit.metadata['loc'],
				})
		});
	}
	constructor(public id: string,
								public pageContent: string,
								public metadata: DocumentChunkMetaData) {
		}
}

export interface TFileLike {
	name: string;
	extension: string;
	path: string
}

type DocumentErrorType = 'extension' | 'read'

interface ThrowableErrorInterface extends Throwable{
	message: string;
}

export abstract class AbstractThrowable implements ThrowableErrorInterface {
	constructor(public message: string) { }

	throw(): void {
		throw new Error(this.message)
	}
}

interface Throwable {
	throw(): void
}

interface Result<T, E extends Throwable> {
	value?: T;
	error?: E;
	ok(): T;
	isOk(): boolean;
	isErr(): boolean;
}

abstract class AbstractResult<T, E extends Throwable> implements Result<T, E>{
	protected constructor(public value?: T,
												public error?: E) {
	}

	public ok() {
		if (this.error) {
			(this.error as unknown as Throwable).throw()
		}
		if (this.value) {
			return this.value;
		}
		throw new Error("Value cannot be undefined")
	}

	public isOk(): boolean {
		return this.value !== undefined;
	}

	public isErr(): boolean {
		return this.error !== undefined;
	}
}

export function ok<T, E extends Throwable>(value: T): Result<T, E> {
	return new Ok(value)
}

export function err<T, E extends Throwable>(err: E): Result<T, E> {
	return new Err(err)
}

class Ok<T, E extends Throwable> extends AbstractResult<T, E>{
	constructor(public value: T) {
		super(value, undefined)
	}
}

class Err<T, E extends Throwable> extends AbstractResult<T, E> {
	constructor(public error: E) {
		super(undefined, error)
	}
}

interface Error<T> {
	message: string,
	type: T
}

export interface DocumentError extends Error<DocumentErrorType>{
	message: string;
	type: DocumentErrorType;
}
// function coerce<T, E>(value: T | E, isTypeT: (value: any) => value is T): value is T {
// 	return isTypeT(value);
// }
export function filterOk<T, E>(value: T | E): value is T {
	return value !== undefined
}

export function tri<T, E>(tryFn: () => T, errFn: () => E): T | E {
	try {
		return tryFn()
	} catch (e) {
		return errFn()
	}
}

export function coerce<T, E>(value: T | E, isTypeT: (value: T | E) => value is T): value is T {
	return isTypeT(value);
}

export function documentOk(docOrErr: Document | DocumentError): docOrErr is Document {
	return docOrErr instanceof Document
}



export class Document implements DocumentInterface<DocumentMetaData> {
	static async fromTFiles(files: TFileLike[] | TFile[], vaultRoot: string) {
		const result = files.map(async (file) => {
			const id = uuidv4();
			if (file.extension !== 'md') {
				return { type: 'extension', message: `unsupported extension '${file.extension}'` } as DocumentError;
			}
			const absPath = path.join(vaultRoot, file.path)
			let pageContent: string
			try {
				pageContent = await fs.readFile(absPath, 'utf8')
			} catch (e) {
				return { type: 'read', message: `could not read ${absPath}`} as DocumentError
			}
			return new Document(id,
				pageContent,
				{
					filename: file.name,
					extension: file.extension,
					path: file.path,
				}
			);
		});
		return Promise.all(result)
	}
	constructor(public id: string,
							public pageContent: string,
							public metadata: DocumentMetaData,) { }
}
