/** What the engine's `jawata/tests/list` answers: a test class with its methods, each with the scope that runs it. */
export interface ListedTest { name: string; label: string; line: number; scope: TestScope }
export interface ListedClass { name: string; uri: string; line: number; framework: string; scope: TestScope; tests: ListedTest[] }
export interface TestScope { kind: 'class' | 'method' | 'package'; typeName?: string; methodName?: string; packageName?: string }

/** One failure in the engine's `jawata/tests/run` answer; `line` is zero-based and present when the engine found the test's own frame. */
export interface RunFailure { testClass: string; testMethod: string; status: string; message: string; line?: number }
export interface RunResult {
  state: string;
  summary: { total?: number; passed?: number; failed?: number; skipped?: number; cancelled?: boolean; timedOut?: boolean };
  failures: RunFailure[];
}

/** An item of the Testing view as plain data: what a host's controller turns into its own item type. */
export interface TestNode { id: string; label: string; uri?: string; line?: number; scope: TestScope; children: TestNode[] }

/** The id of a class's item: its qualified name, which is what a failure names it by. */
export function classIdOf(scope: TestScope): string {
  return scope.typeName ?? scope.packageName ?? '';
}

/** The id of a method's item. */
export function methodIdOf(scope: TestScope): string {
  return `${classIdOf(scope)}#${scope.methodName ?? ''}`;
}

/** The Testing view's tree for what the engine listed: a class per item, its methods inside it. */
export function treeOf(listed: readonly ListedClass[]): TestNode[] {
  return listed.map(cls => ({
    id: classIdOf(cls.scope),
    label: cls.name,
    uri: cls.uri,
    line: cls.line,
    scope: cls.scope,
    children: cls.tests.map(test => ({ id: methodIdOf(test.scope), label: test.label, uri: cls.uri, line: test.line, scope: test.scope, children: [] })),
  }));
}

/** What a finished run did to each item: the ids that passed, and for each failed id the message and the line to show it at. */
export interface Outcome { failed: Map<string, { message: string; line?: number }>; ranIds: string[]; cancelled: boolean }

/**
 * Reads a run's answer against the items it was started for. A failure names its class by qualified name and its method by name, possibly with
 * the parameter types a parameterized or repeated test adds; the id of the method's item is the plain name. A failure that names no listed method
 * is put on the class, so a class that failed to start is red instead of green.
 */
export function outcomeOf(started: readonly TestNode[], result: RunResult): Outcome {
  const known = new Set<string>();
  const walk = (node: TestNode): void => { known.add(node.id); node.children.forEach(walk); };
  started.forEach(walk);
  const failed = new Map<string, { message: string; line?: number }>();
  for (const failure of result.failures) {
    const method = failure.testMethod.replace(/\(.*$/, '').replace(/\[.*$/, '');
    const id = method === '' ? failure.testClass : `${failure.testClass}#${method}`;
    const at = known.has(id) ? id : failure.testClass;
    if (!failed.has(at)) { failed.set(at, { message: failure.message, line: failure.line }); }
  }
  return { failed, ranIds: [...known], cancelled: result.summary.cancelled === true };
}
