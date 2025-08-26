import { useEffect, useState } from "react";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useNavigate } from "react-router-dom";
import Cookies from "js-cookie";

/** Render do Firestore Timestamp / Date / string */
function toDateSafe(dt) {
  if (!dt) return null;
  if (typeof dt?.toDate === "function") return dt.toDate();
  if (dt?.seconds) return new Date(dt.seconds * 1000);
  try {
    const d = new Date(dt);
    return isNaN(d) ? null : d;
  } catch {
    return null;
  }
}

function labelVeiculoAbastecimento(item) {
  const frota = (item?.frotaNumero || "").trim();
  const placa = (item?.placa || "").trim();
  if (frota || placa) return [frota, placa].filter(Boolean).join(" — ");
  return "Sem veículo";
}

const hasValue = (v) => v !== undefined && v !== null && v !== "";

export default function MyAbastecimentos({ motorista }) {
  const [abastecimentos, setAbastecimentos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const navigate = useNavigate();

  useEffect(() => {
    async function fetchData() {
      setLoading(true);

      // Buscar usuarioUid do cookie
      const usuarioUid = Cookies.get("usuarioUid");
      if (!usuarioUid) {
        alert("Usuário não autenticado.");
        navigate("/login");
        return;
      }

      try {
        const qRef = query(
          collection(db, "abastecimentos"),
          where("userId", "==", usuarioUid),  
          orderBy("criadoEm", "desc")
        );
        const snap = await getDocs(qRef);
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setAbastecimentos(rows);
      } catch (err) {
        console.error("Erro ao buscar abastecimentos:", err);
        alert("Erro ao buscar abastecimentos.");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [navigate]);

  const toggleExpand = (id) => {
    setExpandedId((cur) => (cur === id ? null : id));
  };

  return (
    <div className="min-vh-100 d-flex flex-column align-items-center bg-dark text-light py-4 px-2">
      <div className="w-100" style={{ maxWidth: 600 }}>
        {/* Botão Voltar */}
        <button
          type="button"
          className="btn-voltar"
          onClick={() => navigate("/")}
        >
          ← Voltar
        </button>

        <h2 className="fw-bold mb-4 text-white">Meus Abastecimentos</h2>

        {loading ? (
          <div className="text-secondary">Carregando...</div>
        ) : abastecimentos.length === 0 ? (
          <div className="text-secondary">Nenhum abastecimento encontrado.</div>
        ) : (
          abastecimentos.map((item) => {
            const data = toDateSafe(item.criadoEm);
            const label = labelVeiculoAbastecimento(item);

            return (
              <div
                key={item.id}
                className="card mb-3 shadow-sm border-0 bg-white"
                style={{ cursor: "pointer", transition: "background .15s" }}
                onClick={() => toggleExpand(item.id)}
              >
                <div className="card-body pb-2">
                  <div className="d-flex justify-content-between align-items-center">
                    <span className="fw-bold fs-5 text-dark">{label}</span>
                    <span className="text-muted small ms-3">
                      {data ? data.toLocaleString() : "--"}
                    </span>
                  </div>

                  {/* Detalhes expandido */}
                  {expandedId === item.id && (
                    <div className="mt-3 pt-2 border-top">
                      {/* Detalhes do abastecimento */}
                      <div className="small text-secondary mb-2">
                        <b>Combustível:</b> {item.tipoCombustivel}
                      </div>
                      <div className="small text-secondary mb-2">
                        <b>Litros:</b> {item.litros}
                      </div>
                      <div className="small text-secondary mb-2">
                        <b>Preço por Litro:</b> R$ {item.precoPorLitro}
                      </div>
                      <div className="small text-secondary mb-2">
                        <b>Valor Total:</b> R$ {item.valorTotal}
                      </div>
                      <div className="small text-secondary mb-2">
                        <b>Posto:</b> {item.posto || "Não informado"}
                      </div>

                      {/* Observação geral */}
                      {item.obs && (
                        <div className="mt-2 fst-italic small text-secondary">
                          <b>Obs:</b> {item.obs}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
