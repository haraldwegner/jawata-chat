import { Marked } from 'marked';

const markdown = new Marked({ breaks: true, gfm: true });

/** What each character that HTML reserves is written as. */
const ESCAPED = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as const;

/**
 * Markdown to HTML, the way the chat shows an answer. The HTML is NOT safe to insert as it is: the
 * caller sanitises it with a DOM before it goes into the page. Text that cannot be parsed comes back escaped.
 */
export function renderMarkdown(text: string): string {
  try {
    return markdown.parse(text) as string;
  } catch {
    return text.replace(/[&<>"]/g, c => ESCAPED[c as '&' | '<' | '>' | '"']);
  }
}
