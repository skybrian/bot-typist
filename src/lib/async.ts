export class Completer<T> {
    promise: Promise<T>;
    resolve!: (value: T | PromiseLike<T>) => void;
    reject!: (reason?: any) => void;
  
    constructor() {
      this.promise = new Promise<T>((resolve, reject) => {
        // Save the resolve and reject functions so they can be used outside the Promise executor.
        this.resolve = resolve;
        this.reject = reject;
      });
    }
  }