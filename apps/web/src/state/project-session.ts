import type { ErrorEnvelope, LanguageConfig } from '@avs/shared';
import { DEFAULT_LANGUAGE_CONFIG } from '@avs/shared';
import type { GenerationVersion, LockState, Project, ProjectDNA } from '@avs/project-core';
import type {
  ExtractedVisualLanguage,
  NormalizedRequest,
  QCResult,
  ReferencePurpose,
  Scenario,
  StructuredIntelligence,
} from '@avs/ai-core';
import type { CanonicalMasterPrompt, PromptOutput } from '@avs/prompt-engine';
import type { AuthenticatedUser, ReadinessProviders } from '../api/client.js';

/**
 * Client-side ProjectSession state — docs/03_TECHNICAL_ARCHITECTURE.md §7
 * "Frontend state". Locks are resolved server-side by the Reasoning Engine;
 * this state only ever reflects what the API returns (no independent
 * business logic client-side). Real hydration/dispatch wiring is BUILD 03
 * (UI/UX Foundation) — this module only establishes the shape and a minimal
 * framework-agnostic store so later gates don't invent a second one.
 */
export interface SourceImageRef {
  assetId: string;
  url: string;
}

export type AppStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * A completed Reference Intelligence extraction (BUILD 10) — one entry per
 * (reference image, purpose) run. Multiple purposes may be run against the
 * same reference image; the Reference Mixer that combines these with source
 * architecture + scenario + locks into one normalized visual specification
 * (docs/08 "Reference Mixer") is out of scope here, same as BUILD 11's
 * Master Prompt Compiler.
 */
export interface ReferenceExtraction {
  referenceId: string;
  assetId: string;
  purpose: ReferencePurpose;
  extractedVisualLanguage: ExtractedVisualLanguage;
}

/** RELEASE 02 (Security & Production Access Hardening) — 'checking' while the initial `GET /auth/me` is in flight, so the app never briefly flashes the sign-in gate for an already-signed-in user on reload. */
export type AuthStatus = 'checking' | 'signedOut' | 'signedIn';

export interface ProjectSessionState {
  /** RELEASE 02 — the real, server-confirmed signed-in user (never a client-invented identity); `null` until `authStatus` is `'signedIn'`. */
  currentUser: AuthenticatedUser | null;
  authStatus: AuthStatus;
  /** BUILD 27 — `GET /ready`'s provider booleans, fetched once at app bootstrap alongside `GET /auth/me`; `null` until that fetch resolves (or if it fails — never blocks or breaks the app). Purely informational for the AI Image Model selector; the real, authoritative failure path stays the existing `PROVIDER_NOT_CONFIGURED` render-time error. */
  providerConfiguration: ReadinessProviders | null;
  /**
   * Three independent language settings (Architecture Amendment) — UI
   * language is client-only; AI analysis / prompt output languages are
   * carried here so the API request can honor them once BUILD 09+ wire
   * real analysis/compilation calls. Business/domain data itself stays
   * language-neutral (stable identifiers), per the amendment.
   */
  language: LanguageConfig;
  currentProject: Project | null;
  projectDNA: ProjectDNA | null;
  sourceImage: SourceImageRef | null;
  /** Single reference-image slot (docs/02 required control "Reference image and reference purpose", BUILD 10). */
  referenceImage: SourceImageRef | null;
  references: ReferenceExtraction[];
  scenario: Scenario | null;
  /**
   * Raw Vision Analysis Engine output (BUILD 07) — deliberately NOT mapped
   * into `projectDNA` here. Resolving observed facts into preserved DNA is
   * the Reasoning Engine's job (docs/06, BUILD 08); doing it in the UI layer
   * now would implement that gate prematurely.
   */
  structuredIntelligence: StructuredIntelligence | null;
  /** Id of the persisted `AnalysisRecord` (BUILD 07) this project's `structuredIntelligence` came from — needed by AI QC (BUILD 17) to look up the same real analysis server-side instead of re-transmitting it. */
  analysisId: string | null;
  locks: LockState[];
  /**
   * User-editable draft text in the Prompt Editor — distinct from `prompt`
   * (the compiled CanonicalMasterPrompt). Exists because BUILD 11's Master
   * Prompt Compiler doesn't exist yet, but the editor UI must (BUILD 03).
   */
  promptDraft: string;
  prompt: CanonicalMasterPrompt | null;
  /** Full amendment-shaped compiled output (BUILD 11) — structured intelligence, canonical bilingual DNA, and both master prompts. */
  promptOutput: PromptOutput | null;
  /** The Reasoning Engine's resolved output (BUILD 08) from the most recent Compile Prompt — AI QC (BUILD 17) needs the enabled locks/resolved style/instructions this captured to know what the render was actually expected to preserve. */
  normalizedRequest: NormalizedRequest | null;
  generationHistory: GenerationVersion[];
  /** Output image(s) from the most recent successful generation OR edit (BUILD 13/14) — shown in the Canvas in place of the source viewport. */
  latestGenerationOutputUrls: string[];
  /** Id of the most recent GenerationRecord (BUILD 13) — the Advanced Editor (BUILD 14) edits this generation's output, always via the same provider that produced it. */
  latestGenerationId: string | null;
  /** Asset id of the current output (from generation OR a prior edit) — what the Advanced Editor actually edits next. */
  latestOutputAssetId: string | null;
  qcState: QCResult | null;
  status: AppStatus;
  error: ErrorEnvelope | null;
}

export function createInitialProjectSessionState(): ProjectSessionState {
  return {
    currentUser: null,
    authStatus: 'checking',
    providerConfiguration: null,
    language: DEFAULT_LANGUAGE_CONFIG,
    currentProject: null,
    projectDNA: null,
    sourceImage: null,
    referenceImage: null,
    references: [],
    scenario: null,
    structuredIntelligence: null,
    analysisId: null,
    locks: [],
    promptDraft: '',
    prompt: null,
    promptOutput: null,
    normalizedRequest: null,
    generationHistory: [],
    latestGenerationOutputUrls: [],
    latestGenerationId: null,
    latestOutputAssetId: null,
    qcState: null,
    status: 'idle',
    error: null,
  };
}

export type ProjectSessionListener = (state: ProjectSessionState) => void;

/** Minimal, framework-agnostic observable store — no state library chosen yet (BUILD 03 decision). */
export class ProjectSessionStore {
  private state: ProjectSessionState;
  private readonly listeners = new Set<ProjectSessionListener>();

  constructor(initialState: ProjectSessionState = createInitialProjectSessionState()) {
    this.state = initialState;
  }

  getState(): ProjectSessionState {
    return this.state;
  }

  setState(patch: Partial<ProjectSessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  subscribe(listener: ProjectSessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
