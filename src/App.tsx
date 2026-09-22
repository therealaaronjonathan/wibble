import { useAuth } from "./useAuth";
import SignIn from "./components/SignIn";
import Today from "./components/Today";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="screen center">
        <div className="muted">Loading…</div>
      </div>
    );
  }

  return user ? <Today user={user} /> : <SignIn />;
}
