/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Firebase Auth uid of the tracked person. Their logs live under users/{uid}. */
  readonly VITE_PATIENT_UID: string;
  /** First name used in the daily message and the viewer tag. */
  readonly VITE_PATIENT_NAME: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
