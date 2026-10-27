// Explicit admission recorded after the configured endpoint/model passed T01, T08 and T10 synthetic live validation. No endpoint or credential is stored.
export const PLATFORM_ADMISSION = {
  "fingerprint": "9f4d0b16479c6124e0b4239af949ce68f2329f6d83bffdf181344b52bf71e136",
  "adapter": "@ai-sdk/openai-compatible@3.0.78",
  "evidence": "docs/validation/T01-model-protocol.md; docs/validation/T08-conversation.md; docs/validation/T10-requirements.md",
  "acceptedAt": "2026-10-25",
  "scope": "Real API synthetic initial baseline; not real drawing or production reliability approval"
} as const;
