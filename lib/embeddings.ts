import {Err, err, isErr, isOk} from './utils';
import {DocumentChunk} from './core';

interface EmbeddingsError {
	type: 'internal_server_error' | 'bad_request';
	message: string;
}

type ValidDims =  32 | 64 | 128 | 256 | 512 | 768 | 1024;

export interface Options {
	size: ValidDims
	task:
		| 'retrieval.query'
		| 'retrieval.passage'
		| 'separation'
		| 'classification'
		| 'text-matching';
}

const DEFAULT_OPTIONS: Options = {
	size: 1024,
	task: 'retrieval.query'
};

export async function getEmbeddings(texts: string[], options?: Options): Promise<number[][] | Err<EmbeddingsError>> {
	const url = 'http://localhost:8000/api/v1/embeddings';
	const mergedOptions = {...DEFAULT_OPTIONS, ...options};
	const body = JSON.stringify({
		texts,
		...mergedOptions
	});
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body
		});
		if (response.ok) {
			return (await response.json()).embeddings;
		}
		return err({type: 'bad_request', message: 'bad request'});
	} catch (error) {
		return err({type: 'internal_server_error', message: error.message});
	}
}


export class Embeddings {

	static async fromDocumentChunks(documentChunks: DocumentChunk[], options?: Options): Promise<DocumentChunk[]> {
		const chunkEmbeddings = await Promise.all(documentChunks.map(async chunk => {
			const embeddings = await getEmbeddings([chunk.pageContent], options);
			if (isErr(embeddings)) {
				return embeddings;
			}
			return Object.assign(chunk, {_vectors: {pageContent_embeddings: embeddings[0]}}) as DocumentChunk;
		}));

		chunkEmbeddings.filter(isErr<EmbeddingsError>)
			.forEach((err) => console.error(err));

		return chunkEmbeddings.filter(isOk<DocumentChunk>);
	}
}

export function queryRetrievalEmbeddingsProvider(size: ValidDims) {
	return async function(q: string) {
		const result = await getEmbeddings([q], { size, task: 'retrieval.query' })
		if (isErr(result)) {
			console.error(result)
			return [];
		}
		return result[0]
	}
}

