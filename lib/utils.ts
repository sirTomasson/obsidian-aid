import path, {sep} from "path";
import { Document} from "./core";
import * as fs from "node:fs/promises";
import ObsidianAIdPlugin from "../main";

export function getFileName(path: string): string {
    const result = path.split(sep);
    return result[result.length-1];
}

export function getExtension(filename: string): string | undefined {
    const result = filename.split('.');
    if (result.length == 1) {
        return undefined;
    }
    return result[result.length-1];
}

export function documentsToDeleteOrCreate(synced: Document[], unSynced: Document[]) {
	const toDelete: Document[] = [];
	const toCreate: Document[] = [];
	for (const unSyncedDocument of unSynced) {
		const syncedDocument = synced.find((document) => {
			return document.path === unSyncedDocument.path
		});
		if (!syncedDocument) {
			toCreate.push(unSyncedDocument);
		}
	}

	for (const syncedDocument of synced) {
		const unSyncedDocument = unSynced.find((document) => {
			return document.path === syncedDocument.path
		});
		if (!unSyncedDocument) {
			toDelete.push(syncedDocument);
		}
	}
	console.info('documentsToDeleteOrCreate toCreate', toCreate)
	console.info('documentsToDeleteOrCreate toDelete', toDelete)
	return { toCreate, toDelete }
}

export function debounce<T>(callback: (value: T) => Promise<void>, wait: number) {
	let timeout: NodeJS.Timeout;

	return function(value: T) {
		clearTimeout(timeout);
		timeout = setTimeout(() => callback.apply(this, value), wait);
	};
}

export function toMap<T extends Record<string, any>>(values: Iterable<T>, key: Extract<keyof T, string>) {
	const  map = new Map<string, T>();
	for (const value of values) {
		map.set(value[key], value);
	}
	return map
}

export function maybe<T>(value: T | undefined | null, defaultValue: (() => T) | T): T {
	if (value) return value;

	if (typeof defaultValue  === 'function') { return defaultValue.call([]) }

	return defaultValue
}


export async function hydrateDocuments(documents: Document[], vaultRoot: string): Promise<Document[]> {
	const hydratedDocuments = documents.map(async (document) => {
		const absolutePath = path.join(vaultRoot, document.path);
		document.content = await fs.readFile(absolutePath, 'utf8');
		return document
	});
	return Promise.all(hydratedDocuments)
}

export function buildPluginStaticResourceSrc(plugin: ObsidianAIdPlugin, assetPath: string) {
	return plugin.app.vault.adapter.getResourcePath(
		path.join(plugin.app.vault.configDir,
		'plugins',
			plugin.manifest.id,
			assetPath)
	)
}

export function err<T>(value: T): Err<T> {
	return new Err<T>(value);
}

export class Err<T> {
	constructor(public readonly value: T) {}
}

export function isErr<E = unknown>(value: unknown | Err<E>): value is Err<E> {
	return (value instanceof Err)
}

export function isOk<T = unknown, E = unknown>(value: T | Err<E>): value is T {
	return !(value instanceof Err);
}

export function ok<T, E>(valueOrError: T | Err<E>): T {
	if (valueOrError instanceof Err) {
		throw new Error(`Panic! \n\n ${valueOrError}`);
	}
	return valueOrError!;
}

export function asErr<E>(valueOrError: unknown | Err<E>): Err<E> {
	if (valueOrError instanceof Err) {
		return valueOrError!
	}
	throw new TypeError(`Panic!\n\nvalueOrError not an instance Err<E>.`);
}
