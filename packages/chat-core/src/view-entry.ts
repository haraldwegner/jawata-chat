/**
 * What a page needs of the core, and nothing else: the contract between the core and a view (messages, intents, the transport), and the
 * pure fold that turns messages into what the view shows. No agent, no SDK connection, no process. A view imports this entry
 * (`@jawata/chat-core/view`), so that a bundler that does not drop what is unused still ships none of the core's machinery to the page.
 */
export * from './view.js';
export { initialViewState, reduce, waitingLine, isWorking, type ViewState, type PartView, type ToolCallView, type HireView, type ProposalView } from './view-state.js';
