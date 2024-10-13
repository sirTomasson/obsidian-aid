
import {
	DocumentChunk,
	TFileLike,
	documentOk
} from "./core";
import path from "path";
import { Document } from "./core"

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
