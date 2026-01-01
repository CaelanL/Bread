import { getAuthToken, getSupabaseUrl } from "./client";

export interface ProcessRecordingResult {
  transcription: string;
  cleanedTranscription: string;
  cleaningUsed: boolean;
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

  // Fetch audio blob to get size/type for logging
  console.log(`[Recording] Fetching audio from: ${audioUri}`);
  const audioResponse = await fetch(audioUri);
  const audioBlob = await audioResponse.blob();
  console.log(`[Recording] Audio size: ${(audioBlob.size / 1024).toFixed(1)}KB, Type: ${audioBlob.type}`);

  // Validate blob has content
  if (audioBlob.size === 0) {
    throw new Error(`Audio file is empty. URI: ${audioUri}`);
  }

  const formData = new FormData();

  // React Native requires this specific format for file uploads
  // Can't just append a Blob - need uri, type, name
  formData.append("audio", {
    uri: audioUri,
    type: audioBlob.type || "audio/m4a",
    name: "recording.m4a",
  } as unknown as Blob);

  formData.append("durationMs", durationMs.toString());
  formData.append("actualVerse", actualVerse);

  const response = await fetch(`${baseUrl}/functions/v1/process-recording`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      // Don't set Content-Type - let browser set it with boundary for multipart
    },
    body: formData,
  });

  return handleProcessingResponse(response);
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

  const result = await response.json();
  return {
    transcription: result.transcription,
    cleanedTranscription: result.cleanedTranscription,
    cleaningUsed: result.cleaningUsed,
  };
}

