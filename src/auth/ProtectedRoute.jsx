// src/ProtectedRoute.jsx
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

// Splash/loading para cobrir o gap de hidratação do Firebase
function Splash() {
  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-dark text-white">
      <div className="text-center">
        <div className="spinner-border" role="status" aria-hidden="true" />
        <div className="mt-3">Carregando…</div>
      </div>
    </div>
  );
}

/**
 * ProtectedRoute
 * props:
 * - roles?: string[]           -> papéis permitidos (ex: ["admin"])
 * - requireVerified?: boolean  -> exige email verificado (default: false)
 * - redirectTo?: string        -> rota para redirecionar quando bloquear (default: "/")
 * - onlyAnonymous?: boolean    -> rota acessível somente por usuários DESLOGADOS (ex.: /login)
 */
export default function ProtectedRoute({
  roles,
  requireVerified = false,
  redirectTo = "/",
  onlyAnonymous = false,
  children,
}) {
  const { user, role, initializing } = useAuth();
  const location = useLocation();

  // Evita "flash" enquanto Auth carrega
  if (initializing) return <Splash />;

  // Rotas que exigem usuário deslogado (ex.: Login) — se logado, manda pra home
  if (onlyAnonymous) {
    if (user) return <Navigate to={redirectTo} replace />;
    return children;
  }

  // Rotas protegidas: exige estar logado
  if (!user) {
    return (
      <Navigate
        to="/"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  // Checa papéis se informado
  if (roles && !roles.includes(role)) {
    return <Navigate to={redirectTo} replace />;
  }

  // Exige e-mail verificado (opcional)
  if (requireVerified && !user.emailVerified) {
    return <Navigate to={redirectTo} home />;
  }

  return children;
}
