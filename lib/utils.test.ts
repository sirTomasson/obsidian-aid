import {getExtension, getFileName, documentsToDeleteOrCreate} from './utils';

test('should getFilename', () => {
	const path = '/home/john/documents/abc.md';

	const filename = getFileName(path);
	expect(filename).toEqual('abc.md');
});

test('should getFilename when path is same', () => {
	const path = 'abc.md';

	const filename = getFileName(path);
	expect(filename).toEqual('abc.md');
});

test('getExtension', () => {
	const path = '/home/john/documents/abc.md';

	expect(getExtension(path)).toEqual('md');
});

test('should not getExtension', () => {
	const path = '/home/john/documents/abc';

	expect(getExtension(path)).toBeUndefined();
});

test('documentsToDeleteOrCreate', () => {
	const synced = [
		{id: 'a', path: 'x'},
		{id: 'b', path: 'y'},
		{id: 'c', path: 'z'}
	];
	const unSynced = [
		{id: 'a', path: 'q'},
		{id: 'c', path: 'z'},
		{id: 'd', path: 'p'}
	];

	const {toDelete, toCreate} = documentsToDeleteOrCreate(synced, unSynced);
	expect(toDelete).toEqual([{id: 'a', path: 'x'}, {id: 'b', path: 'y'}]);
	expect(toCreate).toEqual([{id: 'a', path: 'q'}, {id: 'd', path: 'p'}]);
});
