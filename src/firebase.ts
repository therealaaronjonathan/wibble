import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Public web config. Safe to ship in the client — access is enforced by
// Firebase Auth + Firestore security rules, not by hiding these values.
const firebaseConfig = {
  apiKey: "AIzaSyAacKySMJDl2tQyKTYJS3kNc2suh_gJo0o",
  // Same origin as the hosted app (web.app serves /__/auth/handler). Keeping
  // auth same-origin avoids the cross-domain popup that fails in installed /
  // standalone PWAs (it opens a blank tab instead of the Google chooser).
  authDomain: "wibble-b82d6.web.app",
  projectId: "wibble-b82d6",
  storageBucket: "wibble-b82d6.firebasestorage.app",
  messagingSenderId: "576549897899",
  appId: "1:576549897899:web:eaef5d8e87fc88019759ee",
  measurementId: "G-86EXYK9Z5Z",
};

const app = initializeApp(firebaseConfig);

// Single-household v1: ONE tracked person ("the patient"). Their glucose
// readings + logs are the shared record that every household member sees.
// Only the patient (owner uid) can write; everyone else is view-only.
// Per-user invites / multi-patient are deferred — see PRD Appendix A.
//
// Who the patient is comes from the build environment (see .env.example), so
// no personal identifiers live in the repository.
export const PATIENT_UID = requireEnv("VITE_PATIENT_UID");
export const PATIENT_NAME = requireEnv("VITE_PATIENT_NAME");

function requireEnv(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Missing ${key}. Copy .env.example to .env.local and fill it in.`
    );
  }
  return value.trim();
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
