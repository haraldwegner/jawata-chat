/**
 * The few Web Streams types chat-core uses. They are a web-platform standard that every host has (a
 * browser, a worker, Node); declaring them here keeps the DOM library, which is the UI's, out of the
 * core's compile.
 */
interface ReadableStream<R = any> {
  pipeTo(destination: WritableStream<R>): Promise<void>;
}
interface WritableStream<W = any> {
  readonly locked: boolean;
}
interface TransformStreamDefaultController<O = any> {
  enqueue(chunk: O): void;
}
interface Transformer<I = any, O = any> {
  transform?(chunk: I, controller: TransformStreamDefaultController<O>): void | Promise<void>;
}
declare class TransformStream<I = any, O = any> {
  constructor(transformer?: Transformer<I, O>);
  readonly readable: ReadableStream<O>;
  readonly writable: WritableStream<I>;
}
