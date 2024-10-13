
export function debouncePromise<I, T>(fn: (arg: I) => Promise<T>, wait: number) {
	let currentPromise = null;
	let timeout: NodeJS.Timeout;
	return function (arg: I) {
		clearTimeout(timeout);
		return new Promise<T>((resolve, reject) => {
			timeout = setTimeout(async () => {
				try {
					currentPromise = fn(arg);
					const result = await currentPromise;
					resolve(result);
				} catch (e) {
					reject(e);
				}
			}, wait)
		});
	}
}
