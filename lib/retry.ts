

export async function retryUntilDone(predicate: (doneFn: () => void) => void | Promise<void>, ms: number): Promise<void> {

  return new Promise((resolve, reject) => {
    let interval: NodeJS.Timer | undefined;
    const doneFn = () => {
      resolve()
      clearInterval(interval)
    }
    asPromise(predicate(doneFn))
      .then(() => {
        const interval = setInterval(async () => {
          try {
            await predicate(doneFn);
          } catch (e) {
            reject(e)
            clearInterval(interval)
          }
        }, ms);
      })
      .catch((error) => {
        reject(error)
        clearInterval(interval)
      });
  })
}


export async function retryUntil(predicate: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      asPromise(predicate())
        .then((result) => {
          if (result) return resolve(result)

          const interval = setInterval(async () => {
            try {
              const result = await predicate();
              if (!result) return;

              clearInterval(interval)
              resolve(result)
            } catch (e) {
              reject(e)
              clearInterval(interval)
            }
          }, ms);
        });
    } catch (e) {
      reject(e)
    }
  });
}

function asPromise<T>(obj: T | Promise<T>): Promise<T> {
  let promise = obj;
  if (!isPromise(obj)) {
    promise = new Promise((resolve, reject) => {
      resolve(obj)
    });
  }
  return promise as Promise<T>
}

function isPromise(obj: any) {
  return !!obj && typeof obj === 'object' && typeof obj.then === 'function';
}