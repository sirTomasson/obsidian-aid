
import {
	AbstractThrowable,
	DocumentChunk,
	ok,
	err,
	TFileLike,
	DocumentError,
	filterOk,
	coerce,
	documentOk
} from "./core";
import path from "path";
import { Document } from "./core"
import fs from "node:fs/promises";

describe('core test', () => {
	const vaultRoot = path.join('data', 'vault');
	const file: TFileLike = {
		name: 'Reading.md',
		extension: 'md',
		path: 'Reading.md'
	};
	const documentChunkParams = { chunkSize: 200, chunkOverlap: 50 };
	it('creates documents from TFile', async () => {
		const documents = (await Document.fromTFiles([file], vaultRoot))
			.filter(documentOk)
		expect(documents.length).toEqual(1);
		expect(documents[0].id).toBeDefined();
		expect(documents[0].pageContent).toBeDefined();
	});

	it('splits documents', async () => {
		const documents = (await Document.fromTFiles([file], vaultRoot))
			.filter(documentOk);
		const documentChunks = await DocumentChunk.fromDocuments(documents, documentChunkParams);

		expect(documentChunks.length).toEqual(2);
		expect(documentChunks[0].metadata.documentId).toEqual(documents[0].id);
		expect(documentChunks[1].metadata.documentId).toEqual(documents[0].id);
	});
});

class MemeError extends AbstractThrowable { }





describe('core test', () => {

	it('blaat', () => {
		let mixedValue: number | string = Math.random() > 0.5 ? 42 : "hello";
		if(coerce<number, string>(mixedValue, mixedValue => typeof mixedValue === 'number')) {
			const a = mixedValue;
		} else {
			const b = mixedValue.toUpperCase();
		}
	});

	it('is ok', () => {
		const result = ok('hI mOm!');
		expect(result.isOk()).toBeTruthy();
		expect(result.isErr()).toBeFalsy();
		expect(result.ok()).toEqual('hI mOm!');
	});

	it('is error', () => {
		const result = err(new MemeError('hI mOm!'));
		expect(result.isErr()).toBeTruthy()
		expect(result.isOk()).toBeFalsy()
		expect(() => result.ok()).toThrow('hI mOm!');
	});

	it('throws erro', async () => {
		// const abc = await fs.readFile('blaatXyz', 'utf8');
		// expect(abc).not.toBeDefined()
		try {
			await fs.readFile('blaatXyz', 'utf8')
		} catch (e) {
			expect(e).toBeDefined();
		}
	})
});
