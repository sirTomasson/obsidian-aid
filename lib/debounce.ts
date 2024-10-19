
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

export function debounce<I>(fn: (arg: I) => unknown, wait: number) {
	let timeout: NodeJS.Timeout | null = null;

	return function (arg: I) {
		if (timeout) clearTimeout(timeout);

		timeout = setTimeout(() => {
			fn(arg);
		}, wait);
	}
}
