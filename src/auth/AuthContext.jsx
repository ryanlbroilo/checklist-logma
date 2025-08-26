import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../services/firebase";
import { doc, getDoc } from "firebase/firestore";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);      // para proteções por perfil
  const [name, setName] = useState(null);      // exibir no header

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);

      if (u) {
        try {
          const snap = await getDoc(doc(db, "usuarios", u.uid));
          if (snap.exists()) {
            const data = snap.data();
            setRole(data.role || null);
            setName(data.nome || null);
          } else {
            setRole(null);
            setName(null);
          }
        } catch {
          setRole(null);
          setName(null);
        }
      } else {
        setRole(null);
        setName(null);
      }

      setInitializing(false); // **só aqui decide o que renderizar**
    });

    return () => unsub();
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, name, initializing }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
