import { ClientSideConnection } from '@agentclientprotocol/sdk';
import type {
  AuthenticateRequest, AuthenticateResponse, CancelNotification, Client, InitializeRequest, InitializeResponse, ListSessionsRequest,
  ListSessionsResponse, LoadSessionRequest, LoadSessionResponse, NewSessionRequest, NewSessionResponse, PromptRequest, PromptResponse,
  ResumeSessionRequest, ResumeSessionResponse, SetSessionConfigOptionRequest, SetSessionConfigOptionResponse, SetSessionModeRequest,
  SetSessionModeResponse, Stream,
} from '@agentclientprotocol/sdk';

/**
 * The chat's side of the connection to an agent, as the chat uses it: one method for each thing it asks of an agent, and `request`
 * for the extension requests of the contract. The rest of the core depends on this interface and never on the SDK's connection
 * class (architecture F13(e)): {@link openAgentLink} is the one place that class is used, so a change of its constructor (1.x
 * deprecates it in favour of `client({name}).connectWith(...)`) or of a method name touches that function alone.
 */
export interface AgentLink {
  initialize(params: InitializeRequest): Promise<InitializeResponse>;
  newSession(params: NewSessionRequest): Promise<NewSessionResponse>;
  listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse>;
  loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse>;
  resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse>;
  prompt(params: PromptRequest): Promise<PromptResponse>;
  cancel(params: CancelNotification): Promise<void>;
  setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse>;
  /** The older model list's request, `session/set_model`: the SDK has no method for it, so it goes out by name. */
  setSessionModel(params: { sessionId: string; modelId: string }): Promise<unknown>;
  setSessionConfigOption(params: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse>;
  authenticate(params: AuthenticateRequest): Promise<AuthenticateResponse>;
  /** A request the SDK has no method for: an extension of the contract, or an unstable one, by its wire name. */
  request<Response = unknown>(method: string, params?: unknown): Promise<Response>;
}

/** Open a link to an agent over `stream`, answering its requests with `client`. */
export function openAgentLink(client: Client, stream: Stream): AgentLink {
  const sdk = new ClientSideConnection(() => client, stream);
  return {
    initialize: (p) => sdk.initialize(p),
    newSession: (p) => sdk.newSession(p),
    listSessions: (p) => sdk.listSessions(p),
    loadSession: (p) => sdk.loadSession(p),
    resumeSession: (p) => sdk.resumeSession(p),
    prompt: (p) => sdk.prompt(p),
    cancel: (p) => sdk.cancel(p),
    setSessionMode: (p) => sdk.setSessionMode(p),
    setSessionModel: (p) => sdk.request('session/set_model', p),
    setSessionConfigOption: (p) => sdk.setSessionConfigOption(p),
    authenticate: (p) => sdk.authenticate(p),
    request: <Response>(method: string, params?: unknown) => sdk.request<Response>(method, params),
  };
}
