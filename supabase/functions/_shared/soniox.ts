// The Soniox model generation for both paths: batch (process-recording) and
// live (transcription-token, whose answer tells the app which model to start).
// Changing it is the whole switch. Soniox retires v5 on 2026-12-15 and sends
// v5 requests to v6 from then on.
const SONIOX_GENERATION = "v5";

export const SONIOX_ASYNC_MODEL = `stt-async-${SONIOX_GENERATION}`;
export const SONIOX_RT_MODEL = `stt-rt-${SONIOX_GENERATION}`;
