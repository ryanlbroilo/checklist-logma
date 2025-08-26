import { useState, useEffect, Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, useParams, Navigate } from "react-router-dom";
import Login from "./components/Login";
import Home from "./pages/Home";
import Checklist from "./pages/Checklist";
import Historico from "./pages/Historico";

// Lazy (admin e manutenção, que são pesados)
const AdminPanel   = lazy(() => import("./pages/AdminPanel"));
const Manutencao   = lazy(() => import("./pages/manutencao"));

// Abastecimento (admin – existentes)
const AbastecimentoDashboard = lazy(() => import("./components/abastecimento/DashboardAbastecimento"));
const LancarAbastecimento    = lazy(() => import("./components/abastecimento/LancarAbastecimento"));

// importar direto dos modules (sem wrappers)
const PublicAbastecimentoForm = lazy(() => import("./modules/abastecimento/PublicAbastecimentoForm"));
const MyAbastecimentos        = lazy(() => import("./modules/abastecimento/MyAbastecimentos"));

import { db, auth } from "./services/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import logo from "./assets/logo.png";

/* ========== Utils de role ========== */
function normalizeRoles(roleField) {
  if (Array.isArray(roleField)) {
    return roleField.map(String).map(r => r.trim().toLowerCase()).filter(Boolean);
  }
  if (typeof roleField === "string") {
    return roleField.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}
function hasRole(roles, name) { return roles.includes(name); }

/* ========== Splash estilizado (Logma) ========== */
function Splash() {
  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-dark text-white">
      <div className="text-center">
        <img
          src={logo}
          alt="Logma Transportes"
          style={{ width: 160, height: 110, objectFit: "contain", filter: "drop-shadow(4px 4px 10px rgba(0,0,0,.6))" }}
        />
        <div className="mt-4"><div className="spinner-border" role="status" aria-hidden="true" /></div>
        <div className="mt-3" style={{ opacity: 0.9 }}>Carregando…</div>
      </div>
    </div>
  );
}

/* ========== Rota dinâmica do Checklist ========== */
function ChecklistRoute({ user }) {
  const { tipoChecklist } = useParams();
  if (!["veiculo", "equipamento", "gerador"].includes(tipoChecklist)) {
    return <Navigate to="/" replace />;
  }
  return <Checklist user={user} tipoChecklist={tipoChecklist} />;
}

function App() {
  const [user, setUser] = useState(null);
  const [loadingRole, setLoadingRole] = useState(false);
  const [initializingAuth, setInitializingAuth] = useState(true);

  const handleLogin = async (nome) => {
    setLoadingRole(true);
    try {
      const q = query(collection(db, "usuarios"), where("nome", "==", nome));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const docUser = snapshot.docs[0];
        const usuarioData = docUser.data();
        const usuarioUid = docUser.id;
        const roles = normalizeRoles(usuarioData.role ?? usuarioData.roles);
        setUser({
          nome: usuarioData.nome || nome,
          role: roles[0] || (typeof usuarioData.role === "string" ? usuarioData.role : "usuario"),
          roles,
          uid: usuarioUid
        });
      } else {
        setUser({ nome, role: "usuario", roles: [], uid: "" });
      }
    } finally {
      setLoadingRole(false);
    }
  };

  const handleLogout = () => setUser(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (userCredential) => {
      if (userCredential) {
        const { uid, email } = userCredential;
        try {
          const q = query(collection(db, "usuarios"), where("email", "==", email));
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            const userData = snapshot.docs[0].data();
            const roles = normalizeRoles(userData.role ?? userData.roles);
            setUser({
              nome: userData.nome || email || "Usuário",
              role: roles[0] || (typeof userData.role === "string" ? userData.role : "usuario"),
              roles,
              uid
            });
          } else {
            setUser({ nome: email || "Usuário", role: "usuario", roles: [], uid });
          }
        } catch {
          setUser({ nome: "Usuário", role: "usuario", roles: [], uid });
        }
      } else {
        setUser(null);
      }
      setInitializingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  if (loadingRole) {
    return (
      <div className="d-flex justify-content-center align-items-center min-vh-100 bg-dark text-white">
        Carregando permissões...
      </div>
    );
  }
  if (initializingAuth) return <Splash />;

  const isAdmin     = user?.roles ? hasRole(user.roles, "admin")     : user?.role === "admin";
  const isMotorista = user?.roles ? hasRole(user.roles, "motorista") : user?.role === "motorista";
  const isVendedor  = user?.roles ? hasRole(user.roles, "vendedor")  : user?.role === "vendedor";
  const canAbastecerPublic = isAdmin || isMotorista || isVendedor;

  return (
    <div className="bg-dark min-vh-100">
      <BrowserRouter>
        <Suspense fallback={<Splash />}>
          <Routes>
            {!user ? (
              <>
                <Route path="*" element={<Login onLogin={handleLogin} />} />
              </>
            ) : (
              <>
                <Route
                  path="/"
                  element={
                    <Home
                      motorista={user.nome}
                      onLogout={handleLogout}
                      role={user.role}
                      roles={user.roles || []}
                    />
                  }
                />

                {/* Checklist dinâmico */}
                <Route path="/checklist/:tipoChecklist" element={<ChecklistRoute user={user} />} />

                <Route path="/historico" element={<Historico motorista={user.nome} />} />

                {/* Manutenções (apenas admin) */}
                <Route path="/manutencao" element={isAdmin ? <Manutencao usuario={user.nome} role={user.role} /> : <Navigate to="/" replace />} />

                {/* Painel admin (apenas admin) */}
                <Route path="/admin" element={isAdmin ? <AdminPanel motorista={user.nome} role={user.role} /> : <Navigate to="/" replace />} />

                {/* ====== Abastecimento (ADMIN – existentes) ====== */}
                <Route path="/abastecimento" element={isAdmin ? <AbastecimentoDashboard /> : <Navigate to="/" replace />} />
                <Route path="/abastecimento/novo/:vehicleId?" element={isAdmin ? <LancarAbastecimento defaultFrota="leve" /> : <Navigate to="/" replace />} />

                <Route
  path="/meus-abastecimentos"
  element={user ? (
    <MyAbastecimentos motorista={user.nome} />
  ) : (
    <Navigate to="/" replace />
  )}
/>
                {/* ====== Abastecimento (PÚBLICO MOTORISTA/VENDEDOR/ADMIN) ====== */}
                <Route
  path="/abastecimento/lancar"
  element={
    canAbastecerPublic ? (
      <div className="container my-3">
        {(() => {
          const allowedFrotas = [
            ...(isAdmin ? ["leve","pesada"] : []),
            ...(!isAdmin && isMotorista ? ["pesada"] : []),
            ...(!isAdmin && isVendedor  ? ["leve"]   : []),
          ];
          // remove duplicadas
          const uniq = [...new Set(allowedFrotas)];
          const defaultFrota =
            isAdmin ? "leve" :
            (isMotorista && !isVendedor ? "pesada"
              : (isVendedor && !isMotorista ? "leve" : ""));

          return (
            <LancarAbastecimento
              publicMode
              allowedFrotas={uniq}
              defaultFrota={defaultFrota}
              lockFrota={uniq.length === 1}
              hideSearch
            />
          );
        })()}
      </div>
    ) : <Navigate to="/" replace />
  }
/>
                {/* Redireciona outros caminhos para Home */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
          </Routes>
        </Suspense>
      </BrowserRouter>
    </div>
  );
}

export default App;
