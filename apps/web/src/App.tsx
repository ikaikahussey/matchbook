import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { MatchPage } from "./pages/MatchPage";
import { MyListPage } from "./pages/MyListPage";
import { TermsPage } from "./pages/TermsPage";
import { Shell } from "./components/Shell";
import { useSession } from "./session";

export default function App() {
  const { session, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location }} />} />
      </Routes>
    );
  }

  if (session.role === "volunteer" && !session.termsAccepted) {
    return (
      <Routes>
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<Navigate to="/terms" replace />} />
      </Routes>
    );
  }

  return (
    <Shell>
      <Routes>
        {session.role === "admin" ? (
          <>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </>
        ) : (
          <>
            <Route path="/match" element={<MatchPage />} />
            <Route path="/my-list" element={<MyListPage />} />
            <Route path="*" element={<Navigate to="/match" replace />} />
          </>
        )}
      </Routes>
    </Shell>
  );
}
