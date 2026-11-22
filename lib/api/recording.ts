import { getAuthToken, getSupabaseUrl } from "./client";

export interface ProcessRecordingResult {
  transcription: string;
  cleanedTranscription: string;
  cleaningUsed: boolean;
  /** The Soniox model; servers before grading reports don't send it. */
  model?: string;
}

/**
 * Process a recording: transcribe with Soniox + clean with GPT
 *
 * Sends audio directly to the edge function as multipart/form-data.
 *
 * @param audioUri - Local URI of the audio file
 * @param durationMs - Duration of the audio in milliseconds
 * @param actualVerse - The actual verse text (for GPT cleaning context)
 * @returns Transcription results with raw and cleaned versions
 */
export async function processRecording(
  audioUri: string,
  durationMs: number,
  actualVerse: string
): Promise<ProcessRecordingResult> {
  const token = await getAuthToken();
  const baseUrl = getSupabaseUrl();

  const formData = new FormData();

  // React Native requires this specific format for file uploads
  // Can't just append a Blob - need uri, type, name
  formData.append("audio", {
    uri: audioUri,
    type: "audio/m4a",
    name: "recording.m4a",
  } as unknown as Blob);

  formData.append("durationMs", durationMs.toString());
  formData.append("actualVerse", actualVerse);

  const response = await postFormData(`${baseUrl}/functions/v1/process-recording`, token, formData);

  return handleProcessingResponse(response);
}

/**
 * The global fetch is expo/fetch from SDK 56, which rejects React Native's
 * `{ uri }` file parts. React Native's own fetch was built on XMLHttpRequest,
 * so this sends the same request as before, with the file streamed natively
 * from its URI and the multipart boundary set by the networking module.
 */
function postFormData(url: string, token: string, body: FormData): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.onload = () =>
      resolve(new Response(xhr.responseText, { status: xhr.status, statusText: xhr.statusText }));
    xhr.onerror = () => reject(new TypeError("Network request failed"));
    xhr.ontimeout = () => reject(new TypeError("Network request timed out"));
    xhr.send(body);
  });
}

/**
 * Handle response from process-recording endpoint
 */
async function handleProcessingResponse(
  response: Response
): Promise<ProcessRecordingResult> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));

    if (response.status === 429) {
      if (error.code === "TRANSCRIPTION_IN_PROGRESS") {
        throw new Error("A transcription is already in progress");
      }
      throw new Error(
        `Daily limit reached (${error.used}/${error.limit}). Resets at ${error.resetsAt || "midnight UTC"}`
      );
    }

    throw new Error(error.error || "Processing failed");
  }

  // The server streams heartbeat whitespace before the JSON payload, and
  // failures mid-stream arrive as 200 + { error } (the status is already
  // committed by then). response.json() tolerates the leading whitespace.
  const result = await response.json();
  if (typeof result.transcription !== "string") {
    throw new Error(result.error || "Processing failed");
  }
  return {
    transcription: result.transcription,
    cleanedTranscription: result.cleanedTranscription,
    cleaningUsed: result.cleaningUsed,
    model: typeof result.model === "string" ? result.model : undefined,
  };
}

