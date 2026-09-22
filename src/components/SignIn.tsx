import { useState } from "react";
import { signIn } from "../useAuth";

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handle() {
    setBusy(true);
    setErr(null);
    try {
      await signIn();
    } catch (e) {
      setErr("Couldn't sign in. Please try again.");
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen center signin">
      <div className="wordmark">wibble</div>
      <p className="tagline">A gentle daily companion.</p>
      <button className="btn-google" onClick={handle} disabled={busy}>
        {busy ? "Signing in…" : "Continue with Google"}
      </button>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
