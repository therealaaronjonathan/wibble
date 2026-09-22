import { useEffect, useState } from "react";
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

export type AuthState = {
  user: User | null;
  loading: boolean;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    // Complete any redirect-based sign-in (PWA / popup-blocked path) and run
    // the user-doc upsert for it. onAuthStateChanged still fires the user in.
    getRedirectResult(auth)
      .then((cred) => {
        if (cred?.user) upsertUser(cred.user);
      })
      .catch((e) => console.error("[auth] redirect result failed", e));

    return onAuthStateChanged(auth, (user) => {
      setState({ user, loading: false });
    });
  }, []);

  return state;
}

async function upsertUser(u: User): Promise<void> {
  // Create / refresh the user doc on every sign-in (idempotent merge).
  await setDoc(
    doc(db, "users", u.uid),
    {
      displayName: u.displayName ?? null,
      email: u.email ?? null,
      lastSeenAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// Always redirect, never popup. Popups are unreliable across the surfaces this
// app actually runs on: an installed/standalone PWA can't open a real popup
// (window.open spawns a tab that never returns), and some desktop setups open
// the popup as a tab too. Redirect navigates the current tab to Google and
// back — it can never spawn a stray tab. authDomain is same-origin (web.app),
// so getRedirectResult below reliably completes the round trip.
export async function signIn(): Promise<void> {
  await signInWithRedirect(auth, googleProvider);
  // Page navigates away here; the user-doc upsert happens in getRedirectResult.
}

export function signOut(): Promise<void> {
  return fbSignOut(auth);
}
