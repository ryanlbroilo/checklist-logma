import { useState } from "react";
import { signInWithEmailAndPassword, setPersistence, browserSessionPersistence, browserLocalPersistence, signOut } from "firebase/auth";
import { db, auth } from "../services/firebase";
import { collection, query, where, getDocs, doc, getDoc, limit } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import Cookies from "js-cookie";
import logo from "../assets/logo.png";

export default function Login({ onLogin }) {
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);
  const [manterLogado, setManterLogado] = useState(false);

  const [userData, setUserData] = useState(null);
  const navigate = useNavigate();

  // 1) Buscar email pelo NOME (sem reCAPTCHA)
  async function buscarEmailPorNomeSeguro(nomeBuscado) {
    try {
      const q = query(
        collection(db, "usuarios"),
        where("nome", "==", nomeBuscado),
        limit(2)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      if (snap.size > 1) return "duplicado";
      return snap.docs[0].data().email || null;
    } catch (e) {
      console.error("Erro ao buscar email:", e);
      return null;
    }
  }

  // 2) Após autenticar: ler doc do usuário SEM criar nada
  async function obterDadosUsuarioPosAuth(uid, email, nomeDigitado) {
    // 2.1 por EMAIL
    if (email) {
      try {
        const qEmail = query(
          collection(db, "usuarios"),
          where("email", "==", email),
          limit(1)
        );
        const snapEmail = await getDocs(qEmail);
        if (!snapEmail.empty) return snapEmail.docs[0].data();
      } catch (e) {
        console.warn("Leitura por email bloqueada nas regras:", e);
      }
    }

    // 2.2 por NOME (se existir e for único)
    if (nomeDigitado) {
      try {
        const qNome = query(
          collection(db, "usuarios"),
          where("nome", "==", nomeDigitado),
          limit(1)
        );
        const snapNome = await getDocs(qNome);
        if (!snapNome.empty) return snapNome.docs[0].data();
      } catch (e) {
        console.warn("Leitura por nome bloqueada/sem acesso:", e);
      }
    }

    // 2.3 por UID (só se o doc realmente usa o uid como id; protege com try/catch)
    try {
      const refUid = doc(db, "usuarios", uid);
      const userDoc = await getDoc(refUid);
      if (userDoc.exists()) return userDoc.data();
    } catch (e) {
      console.warn("Leitura por uid bloqueada/sem acesso:", e);
    }

    return null;
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setErro(null);
    setSucesso(null);

    const nomeTrim = nome.trim();
    const senhaTrim = senha.trim();

    try {
      // Persistência (sessão/local)
      await setPersistence(
        auth,
        manterLogado ? browserLocalPersistence : browserSessionPersistence
      );

      // Descobrir email a partir do nome (se teu fluxo exige nome no login)
      const email = await buscarEmailPorNomeSeguro(nomeTrim);
      if (!email) {
        setErro("Usuário não encontrado. Procure o administrador para verificar seu cadastro.");
        return;
      }
      if (email === "duplicado") {
        setErro("Nome duplicado. Procure o responsável para corrigir seu cadastro.");
        return;
      }

      // Autentica com email + senha
      const cred = await signInWithEmailAndPassword(auth, email, senhaTrim);
      const uid = cred.user.uid;
      const authEmail = cred.user.email || email;

      // Lê dados de /usuarios (apenas leitura)
      const dados = await obterDadosUsuarioPosAuth(uid, authEmail, nomeTrim);
      if (!dados) {
        setErro("Permissão insuficiente para ler seu cadastro. Avise o administrador.");
        return;
      }

      // Cookie com uid (7 dias)
      Cookies.set("usuarioUid", uid, { expires: 7 });

      // Guarda alguns dados (opcional)
      setUserData({ uid, role: dados.role, nome: dados.nome });

      // Notifica App (compat) e vai pra Home
      try {
        if (typeof onLogin === "function") {
          onLogin(dados.nome, dados.role);
        }
      } catch {}
      navigate("/"); // tua App usa "/" como Home
    } catch (error) {
      if (error.code === "auth/wrong-password" || error.code === "auth/user-not-found") {
        setErro("Nome ou senha incorretos.");
      } else if (error.code === "auth/too-many-requests") {
        setErro("Muitas tentativas. Tente novamente em alguns minutos ou troque sua senha.");
      } else {
        setErro("Erro ao fazer login. Tente novamente ou contate o administrador.");
      }
      console.error(error);
    }
  };

  return (
    <div className="min-vh-100 d-flex flex-column justify-content-center align-items-center bg-dark">
      <div className="bg-white shadow-lg rounded-4 p-4 p-md-5 w-100" style={{ maxWidth: 420 }}>
        {/* Logo */}
        <div className="text-center mb-3">
          <img
            src={logo}
            alt="Logma Transportes"
            style={{
              width: 88,
              height: 88,
              objectFit: "contain",
              filter: "drop-shadow(2px 2px 6px rgba(0,0,0,.4))"
            }}
          />
        </div>

        <h1 className="login-title">Login</h1>

        {erro && <div className="alert alert-danger text-center py-2">{erro}</div>}
        {sucesso && <div className="alert alert-success text-center py-2">{sucesso}</div>}

        <form onSubmit={handleLogin} className="mt-3">
          <div className="mb-3">
            <input
              type="text"
              placeholder="Nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="form-control form-control-lg"
              required
              autoFocus
            />
          </div>
          <div className="mb-3">
            <input
              type="password"
              placeholder="Senha"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="form-control form-control-lg"
              required
            />
          </div>

          <div className="form-check mb-4">
            <input
              id="manterLogado"
              type="checkbox"
              className="form-check-input"
              checked={manterLogado}
              onChange={() => setManterLogado((v) => !v)}
            />
            <label htmlFor="manterLogado" className="form-check-label text-dark">
              Manter logado
            </label>
          </div>

          <button type="submit" className="btn-login">
            Entrar
          </button>
        </form>

        <div className="mt-3 text-center small text-muted">
          Precisa de acesso ou alterar senha? Procure o administrador.
        </div>
      </div>

      <footer className="mt-4 pt-4 text-center w-100 text-white">
        <small>
          Criado por <strong>Ryan L Broilo</strong> • Logma Transportes • 2025
        </small>
      </footer>
    </div>
  );
}
