import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { verifyJwt } from "../_shared/auth.ts";
import { handleCors } from "../_shared/cors.ts";
import {
  badRequest,
  jsonResponse,
  serverError,
  unauthorized,
} from "../_shared/errors.ts";
import {
  recordEvaluateUsage,
  recordTranscriptionUsage
} from "../_shared/usage.ts";

const SONIOX_API_KEY = Deno.env.get("SONIOX_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

interface ProcessingResult {
  transcription: string;
  cleanedTranscription: string;
  cleaningUsed: boolean;
}

interface TranscriptionTiming {
  uploadMs: number;
  jobMs: number;
  pollMs: number;
  fetchMs: number;
  totalMs: number;
}

interface TranscriptionResult {
  text: string;
  timing: TranscriptionTiming;
}

serve(async (req) => {
  const requestStart = Date.now();

  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Only POST allowed
  if (req.method !== "POST") {
    return badRequest("Method not allowed");
  }

  // Authenticate user (local JWT verification - <1ms)
  const authStart = Date.now();
  const user = await verifyJwt(req);
  const authMs = Date.now() - authStart;
  if (!user) {
    return unauthorized();
  }

  let audioBlob: Blob;
  let durationMs: number;
  let actualVerse: string;

  try {
    // Parse multipart form data
    const formData = await req.formData();
    const audioFile = formData.get("audio");
    const durationStr = formData.get("durationMs");
    const verseStr = formData.get("actualVerse");

    if (!audioFile || !(audioFile instanceof File)) {
      return badRequest("Missing audio file");
    }
    if (!durationStr || typeof durationStr !== "string") {
      return badRequest("Missing durationMs");
    }
    if (!verseStr || typeof verseStr !== "string") {
      return badRequest("Missing actualVerse");
    }

    audioBlob = audioFile;
    durationMs = parseFloat(durationStr);
    actualVerse = verseStr;

    if (isNaN(durationMs) || durationMs <= 0) {
      return badRequest("Invalid durationMs");
    }

    // Quota check removed - usage is still recorded for analytics
    // Rate limiting can be re-enabled server-side without app update
    const durationSeconds = durationMs / 1000;
    console.log(`[PROCESS] User: ${user.id.slice(0, 8)}..., Duration: ${durationSeconds.toFixed(2)}s, Size: ${(audioBlob.size / 1024).toFixed(1)}KB`);

    const transcribeStart = Date.now();
    const transcriptionResult = await transcribeWithSoniox(audioBlob, actualVerse);
    const transcription = transcriptionResult.text;
    const transcribeTiming = transcriptionResult.timing;
    const transcribeMs = Date.now() - transcribeStart;

    const rawWordCount = transcription.split(/\s+/).filter(Boolean).length;
    console.log(`[PROCESS] Transcription: ${transcribeMs}ms`);
    console.log(`[PROCESS] Raw (${rawWordCount} words, ${transcription.length} chars): "${transcription.slice(0, 200)}${transcription.length > 200 ? "..." : ""}"`);

    // Record transcription usage
    const recordStart = Date.now();
    await recordTranscriptionUsage(user.id, durationSeconds);
    const recordMs = Date.now() - recordStart;
    console.log(`[PROCESS] Usage recorded: ${recordMs}ms`);

    // ========== CLEANING (disabled - skip LLM, use raw transcription) ==========
    const CLEANING_ENABLED = false;
    let cleanedTranscription: string;
    let cleaningUsed = false;

    if (CLEANING_ENABLED) {
      try {
        const cleanStart = Date.now();
        const cleanResult = await cleanTranscription(actualVerse, transcription);
        const cleanMs = Date.now() - cleanStart;

        cleanedTranscription = cleanResult.text;

        // Cleaning used = OpenAI succeeded AND returned non-empty
        // (empty means LLM had nothing to clean, e.g. empty transcript)
        cleaningUsed = cleanResult.model !== undefined && cleanedTranscription.trim().length > 0;

        if (cleaningUsed) {
          await recordEvaluateUsage(user.id);
          const cleanedWordCount = cleanedTranscription.split(/\s+/).filter(Boolean).length;
          const wordsRemoved = rawWordCount - cleanedWordCount;

          console.log(`[PROCESS] Cleaning: ${cleanMs}ms`);
          if (cleanResult.model) {
            console.log(`[PROCESS] Model: ${cleanResult.model}`);
          }
          if (cleanResult.usage) {
            console.log(`[PROCESS] Tokens - Input: ${cleanResult.usage.inputTokens}, Output: ${cleanResult.usage.outputTokens}, Reasoning: ${cleanResult.usage.reasoningTokens}, Total: ${cleanResult.usage.totalTokens}`);
          }
          console.log(`[PROCESS] Cleaned (${cleanedWordCount} words, ${cleanedTranscription.length} chars, ${wordsRemoved} words removed): "${cleanedTranscription.slice(0, 200)}${cleanedTranscription.length > 200 ? "..." : ""}"`);
        } else {
          console.log(`[PROCESS] Cleaning: returned empty (nothing to clean)`);
        }
      } catch (cleanError) {
        console.error("[PROCESS] Cleaning failed, using raw:", cleanError);
        cleanedTranscription = transcription;
        cleaningUsed = false;
      }
    } else {
      // Cleaning disabled - pass raw transcription through
      cleanedTranscription = transcription;
      cleaningUsed = false;
      console.log(`[PROCESS] Cleaning: skipped (disabled)`);
    }

    const totalMs = Date.now() - requestStart;
    const wordCount = cleanedTranscription.split(/\s+/).filter(Boolean).length;
    const sizeKB = (audioBlob.size / 1024).toFixed(1);

    // Comprehensive summary log
    console.log(
      `[PROCESS] ✓ ${totalMs}ms | ${durationSeconds}s recording (${sizeKB}KB) | ${wordCount} words\n` +
      `         → Auth: ${authMs}ms | Upload: ${transcribeTiming.uploadMs}ms | Job: ${transcribeTiming.jobMs}ms | ` +
      `Poll: ${transcribeTiming.pollMs}ms | Fetch: ${transcribeTiming.fetchMs}ms | Usage: ${recordMs}ms`
    );

    return jsonResponse({
      transcription,
      cleanedTranscription,
      cleaningUsed,
    } satisfies ProcessingResult);
  } catch (error) {
    console.error("[PROCESS] Error:", error);
    return serverError("Processing failed");
  }
});

/**
 * Transcribe audio using Soniox async API
 * @param audioBlob - The audio file to transcribe
 * @param verseText - The expected verse text for context (improves accuracy)
 */
async function transcribeWithSoniox(audioBlob: Blob, verseText: string): Promise<TranscriptionResult> {
  if (!SONIOX_API_KEY) {
    throw new Error("SONIOX_API_KEY not configured");
  }

  // Step 1: Upload audio file
  const uploadStart = Date.now();
  console.log(`[PROCESS] Soniox upload - Size: ${(audioBlob.size / 1024).toFixed(1)}KB, Type: ${audioBlob.type || "unknown"}`);

  const uploadForm = new FormData();
  uploadForm.append("file", audioBlob, "recording.m4a");

  const uploadRes = await fetch("https://api.soniox.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${SONIOX_API_KEY}` },
    body: uploadForm,
  });

  if (!uploadRes.ok) {
    const error = await uploadRes.text();
    console.error("Soniox upload error:", error);
    throw new Error("Failed to upload audio");
  }

  const uploadResult = await uploadRes.json();
  const fileId = uploadResult.id;
  const uploadMs = Date.now() - uploadStart;
  console.log(`[PROCESS] Soniox upload complete: ${uploadMs}ms, ID: ${fileId}`);

  // Step 2: Create transcription job with verse context
  const jobStart = Date.now();
  console.log(`[PROCESS] Soniox context: ${verseText.length} chars`);
  const jobRes = await fetch("https://api.soniox.com/v1/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SONIOX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_id: fileId,
      model: "stt-async-v3",
      language_hints: ["en"],
      context: {
        general: [
          { key: "domain", value: "Bible" },
          { key: "topic", value: "Bible verse memory recitation attempt" },
        ],
        text: verseText,
      },
    }),
  });

  if (!jobRes.ok) {
    const error = await jobRes.text();
    console.error("Soniox job error:", error);
    throw new Error("Failed to create transcription job");
  }

  const { id: transcriptionId } = await jobRes.json();
  const jobMs = Date.now() - jobStart;
  console.log(`[PROCESS] Soniox job created: ${jobMs}ms`);

  // Step 3: Poll for completion (max 60 seconds)
  const pollStart = Date.now();
  let attempts = 0;
  const maxAttempts = 60;

  while (attempts < maxAttempts) {
    const statusRes = await fetch(
      `https://api.soniox.com/v1/transcriptions/${transcriptionId}`,
      { headers: { Authorization: `Bearer ${SONIOX_API_KEY}` } }
    );

    if (!statusRes.ok) {
      throw new Error("Failed to check transcription status");
    }

    const status = await statusRes.json();

    if (status.status === "completed") {
      break;
    }

    if (status.status === "error") {
      console.error("[PROCESS] Soniox transcription error:", JSON.stringify(status));
      throw new Error(`Transcription failed: ${status.error || status.message || "unknown error"}`);
    }

    // Wait 1 second before polling again
    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;
  }

  if (attempts >= maxAttempts) {
    throw new Error("Transcription timed out");
  }

  const pollMs = Date.now() - pollStart;
  console.log(`[PROCESS] Soniox polling complete: ${pollMs}ms (${attempts + 1} polls)`);

  // Step 4: Get transcript
  const fetchStart = Date.now();
  const transcriptRes = await fetch(
    `https://api.soniox.com/v1/transcriptions/${transcriptionId}/transcript`,
    { headers: { Authorization: `Bearer ${SONIOX_API_KEY}` } }
  );

  if (!transcriptRes.ok) {
    throw new Error("Failed to get transcript");
  }

  const { text } = await transcriptRes.json();
  const fetchMs = Date.now() - fetchStart;
  console.log(`[PROCESS] Soniox fetch transcript: ${fetchMs}ms`);

  const totalMs = Date.now() - uploadStart;

  return {
    text,
    timing: {
      uploadMs,
      jobMs,
      pollMs,
      fetchMs,
      totalMs,
    },
  };
}

interface CleaningResult {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model?: string;
}

/**
 * Clean transcription using GPT-5-mini
 * Removes stutters, fillers, false starts while keeping user's actual words
 */
async function cleanTranscription(
  actualVerse: string,
  rawTranscription: string
): Promise<CleaningResult> {
  if (!OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, returning raw transcription");
    return { text: rawTranscription };
  }

  const prompt = `Clean this speech-to-text transcription of a Bible verse recitation.

ACTUAL VERSE (for context on intentional repetition):
${actualVerse}

RAW TRANSCRIPTION:
${rawTranscription}

CLEANING RULES:
- Remove stutters ("the the the" → "the")
- Remove filler words (um, uh, er, like, you know)
- Remove false starts/restarts ("For God so lov- For God so loved" → "For God so loved")
- Remove self-corrections ("wait no", "I mean", "sorry")
- KEEP intentional repetition that matches the actual verse (like "holy, holy, holy")
- KEEP their word choices even if wrong - don't correct to match the actual verse
- RETURN EMPTY STRING (return nothing) IF empty transcript, and unable to clean.
- DO NOT ADD words user did not say in transcript

Return ONLY the cleaned transcription text. No explanations, no quotes, no labels.`;

  try {
    const openaiStart = Date.now();
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        max_output_tokens: 3000,
        reasoning: { effort: "low" },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[PROCESS] OpenAI API error status:", response.status);
      console.error("[PROCESS] OpenAI API error body:", error);
      return { text: rawTranscription }; // Fallback to raw
    }

    const result = await response.json();
    const openaiMs = Date.now() - openaiStart;
    console.log(`[PROCESS] OpenAI request: ${openaiMs}ms`);

    // Extract text from Responses API format
    const messageOutput = result.output?.find(
      (o: { type: string }) => o.type === "message"
    );
    const outputText = messageOutput?.content?.find(
      (c: { type: string }) => c.type === "output_text"
    )?.text?.trim();

    // Extract usage info
    const usage = result.usage ? {
      inputTokens: result.usage.input_tokens || 0,
      outputTokens: result.usage.output_tokens || 0,
      reasoningTokens: result.usage.output_tokens_details?.reasoning_tokens || 0,
      totalTokens: result.usage.total_tokens || (result.usage.input_tokens || 0) + (result.usage.output_tokens || 0),
    } : undefined;

    return {
      text: outputText || rawTranscription,
      usage,
      model: result.model,
    };
  } catch (error) {
    console.error("OpenAI request error:", error);
    return { text: rawTranscription }; // Fallback to raw
  }
}
