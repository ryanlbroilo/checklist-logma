import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db, auth } from "../services/firebase";

export function useUserRoles() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setRoles([]);
        setLoading(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, "perfis", user.uid));
        const data = snap.exists() ? snap.data() : {};
        setRoles(Array.isArray(data.roles) ? data.roles : []);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub?.();
  }, []);

  const isAdmin = roles.includes("admin");
  const isMotorista = roles.includes("motorista");
  const isVendedor = roles.includes("vendedor");

  return { roles, isAdmin, isMotorista, isVendedor, loading };
}
