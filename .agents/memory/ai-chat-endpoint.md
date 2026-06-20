---
name: AI chat endpoint
description: Backend route for AI general chat used by Feature Hub paid features
---

## Rule
POST /api/mt-import/ai-chat — accepts { prompt, systemPrompt }, returns { response: string }.
Defined in artifacts/api-server/src/routes/mt-import.ts (same file as OCR route).
Uses gpt-4o, max_tokens: 1024.

**Why:** All paid AI feature panels in FeatureHubPanel call callAI() which hits this endpoint.
The callAI() helper is a module-level async function in App.tsx (no dynamic import needed).

## How to apply
Any new AI-powered feature panel should call callAI(prompt, systemPrompt) from App.tsx.
The function is already defined and the backend is live. No auth header needed (no Clerk on api-server).
