/** What the engine's code action says to ask before a refactoring can be staged, and what to send back to stage it. */
interface Question { name: string; prompt: string; choices: string[] }
export interface Asking { id: string; uri: string; line: number; column: number; inputs: Question[] }

/** How a host asks one question: a pick from `choices` when there are some, free text otherwise; undefined when the person cancelled. */
export interface Asker {
  pick(prompt: string, choices: readonly string[]): Promise<string | undefined>;
  type(prompt: string): Promise<string | undefined>;
}

/**
 * The generic prompt command's whole job: asks the person each question the engine named, in order, and answers the request that stages the
 * refactoring; undefined when the person cancelled any question, so nothing is staged. No refactoring is named here, so a refactoring added to
 * the engine's table is offered, asked and staged with no change to the editor.
 */
export async function stagingOf(asking: Asking, asker: Asker): Promise<{ id: string; uri: string; line: number; column: number; inputs: Record<string, string> } | undefined> {
  const inputs: Record<string, string> = {};
  for (const question of asking.inputs) {
    const answer = question.choices.length > 0 ? await asker.pick(question.prompt, question.choices) : await asker.type(question.prompt);
    if (answer === undefined || answer.trim() === '') { return undefined; }
    inputs[question.name] = answer.trim();
  }
  return { id: asking.id, uri: asking.uri, line: asking.line, column: asking.column, inputs };
}
