/** A place in a source file, in the language protocol's own shape: zero-based line and character. */
export interface ProfileLocation {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

/** One hot method as the engine ranked it; `location` is absent for a method with no source in the workspace, such as one in the JDK. */
export interface ProfileRow {
  symbol: string;
  samples?: number;
  wallMillis?: number;
  sharePercent?: number;
  location?: ProfileLocation;
}

/** The engine's answer to `jawata/profile`. */
export interface ProfileResult {
  dimension: string;
  totalSamples: number;
  totalMethods: number;
  rows: ProfileRow[];
}

export interface SampleRequest {
  seconds: number;
  dimension: string;
}

/**
 * Everything the page needs from the host that shows it: record the person's running program and rank it, and open a source place. A host
 * supplies one of these; the page never learns which editor it is in or how the engine is reached.
 */
export interface ProfileSource {
  sample(request: SampleRequest): Promise<ProfileResult>;
  open(location: ProfileLocation): void;
}
