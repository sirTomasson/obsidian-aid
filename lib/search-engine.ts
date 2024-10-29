import {EnqueuedTask, Index, MeiliSearch, SearchParams, SearchResponse} from 'meilisearch';
import {Document} from './core';

type EmbeddingProvider = (q: string) => Promise<number[]>

export interface ObsidianSearchEngine<T extends Document> {
	search(q: string): Promise<SearchResponse<T>>;

	findBy<V = unknown>(value: V, property: string): Promise<T[]>;

	add(documents: T[]): Promise<void>;

	delete(documents: T[]): Promise<void>;

	deleteBy<V = unknown>(value: V, property: string): Promise<void>;

	deleteByFilter(filter: string): Promise<void>;

	healthy(): Promise<boolean>;

	createIndex(): Promise<boolean>;

	deleteIndex(): Promise<void>;

	all(options: QueryOptions<T>): AsyncGenerator<T[]>

	vectorSearch(q: string): Promise<SearchResponse<T[]>>;
}

export interface QueryOptions<T> {
	offset?: number,
	fields?: Array<Extract<keyof T, string> | string>,
	limit?: number
}

function defaultQueryOptions<T>(): QueryOptions<T> {
	return {
		offset: 0,
		limit: 20,
		fields: []
	}
}

function asArray<T>(value: T | T[]): T[] {
	if (Array.isArray(value)) {
		return value
	}
	return [value]
}

function createFilter<V, T>(value: V[] | V, property: Extract<keyof T, string>): { filter: string } {
	const arrayValue = asArray(value).map(value => `"${value}"`).join(', ');
	return {filter: `${property} IN [${arrayValue}]`};
}

export class MeiliSearchEngine<T extends Document> implements ObsidianSearchEngine<T> {
	constructor(private client: MeiliSearch,
							private indexUid: string,
							private embeddingsProvider: EmbeddingProvider) {
	}

	private index(): Index<T> {
		return this.client.index<T>(this.indexUid)
	}

	private async handleTask(enqueuedTask: EnqueuedTask) {
		const task = await this.client.waitForTask(enqueuedTask.taskUid);
		if (task.status === 'succeeded') {
			console.info(`{ task: ${enqueuedTask.type}, ${task.status}_at: ${task.finishedAt}, started: ${task.startedAt}, took: ${task.duration} }`)
		} else {
			console.error(`{ task: ${enqueuedTask.type}, ${task.status}_at: ${task.finishedAt}, started: ${task.startedAt}, took: ${task.duration}, error: ${task.error?.message} }`)
		}
	}

	async add(documents: T[]): Promise<void> {
		const enqueuedTask = await this.index().addDocuments(documents);
		await this.handleTask(enqueuedTask);
	}

	async search(q: string): Promise<SearchResponse<T>> {
		const options: SearchParams = {
			showRankingScore: true,
			showRankingScoreDetails: true
		}
		return await this.index().search(q, options)
	}

	all(options: QueryOptions<T>): AsyncGenerator<T[]> {
		return dataLoader<T>(this.index(), options)
	}

	async healthy(): Promise<boolean> {
		try {
			const health = await this.client.health();
			return health.status == "available";
		} catch (e) {
			return false;
		}
	}

	async delete(documents: T[]): Promise<void> {
		const documentIds = documents.map((document) => document.id)
		const enqueuedTask = await this.index().deleteDocuments(documentIds)
		await this.handleTask(enqueuedTask);
	}

	async deleteIndex(): Promise<void> {
		const enqueuedTask = await this.client.deleteIndex(this.indexUid);
		await this.handleTask(enqueuedTask);
	}

	async createIndex(): Promise<boolean> {
		const exists = await this.indexExists();
		if (exists) return true;

		const enqueuedTasks = await Promise.all([
			this.client.createIndex(this.indexUid),
			this.client.index(this.indexUid).updateFilterableAttributes(['metadata.path']),
			this.client.index(this.indexUid).updateEmbedders({
				pageContent_embeddings: {
					source: 'userProvided',
					dimensions: 512,
				}
			})
		]);
		const tasks = await this.client.waitForTasks(enqueuedTasks.map(enqueuedTask => enqueuedTask.taskUid));
		const failedTasks = tasks.filter(task => task.status === 'failed');
		failedTasks.forEach(failedTask => (console.error(`{ index: ${failedTask.indexUid} task: ${failedTask.type}, ${failedTask.status}_at: ${failedTask.finishedAt}, started: ${failedTask.startedAt}, took: ${failedTask.duration}, error: ${failedTask.error?.message} }`)));
		return true
	}

	async deleteBy<V = unknown>(value: V, property: Extract<keyof T, string>): Promise<void> {
		const filter = createFilter(value, property)
		const enqueuedTask = await this.index().deleteDocuments(filter);
		await this.handleTask(enqueuedTask);
	}

	async findBy<V = unknown>(value: V, property: Extract<keyof T, string>): Promise<T[]> {
		const index = this.index();
		const result = await index.getDocuments({filter: `${property} = "${value}"`});
		return result.results;
	}

	// async vectorSearch(q: string): Promise<SearchResponse<T[]>> {
	// 	const vector = await this.embeddingsProvider(q);
	// 	return await vectorSearch<T>(vector, this.client, this.indexUid, {
	// 		limit: 10
	// 	})
	// }

	async vectorSearch(q: string): Promise<SearchResponse<T[]>> {
		const vector = await this.embeddingsProvider(q);
		return await this.index().search(null, {
			vector,
			hybrid: {
				embedder: 'pageContent_embeddings'
			}
		});
	}

	async deleteByFilter(filter: string): Promise<void> {
		const enqueuedTask = await this.index().deleteDocuments({ filter });
		await this.handleTask(enqueuedTask);
	}

	async indexExists(): Promise<boolean> {
		try {
			await this.client.getIndex(this.indexUid);
			return true;
		} catch (error: any) {
			if (error.code === 'index_not_found') {
				return false;
			}
			throw error;
		}
	}
}

async function* dataLoader<T extends Document>(index: Index<T>, options: QueryOptions<T>): AsyncGenerator<T[]> {
	const queryOptions = Object.assign(defaultQueryOptions<T>(), options);

	let promise = index.getDocuments(queryOptions);
	while (true) {
		const values = await promise;
		if (values.results.length == 0) {
			break
		}
		// @ts-ignore
		queryOptions.offset += queryOptions.limit;
		promise = index.getDocuments(queryOptions);
		yield values.results
	}
}


export async function vectorSearch<T>(
	vector: number[],
	client: MeiliSearch,
	indexUid: string,
	options: QueryOptions<T>
): Promise<SearchResponse<T[]>> {
	const url = `${client.config.host}/indexes/${indexUid}/search`;

	const body = JSON.stringify({
		vector,
		...options,
	});
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${client.config.apiKey}`
			},
			body,
		});
		if (response.ok) {
			return await response.json();
		}
		console.error(await response.json())
	} catch (error) {
		console.error(error);
	}
	return [];
}
