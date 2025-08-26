import { useEffect, useState } from "react";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { db } from "../services/firebase";
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

function labelVeiculoHistorico(item) {
  if (item?.selecionadoNome) return item.selecionadoNome;
  const frota = (item?.frotaNumeroSnapshot || "").trim();
  const placa = (item?.placaSnapshot || "").trim();
  if (frota || placa) return [frota, placa].filter(Boolean).join(" — ");
  return "Sem veículo";
}

const hasValue = (v) => v !== undefined && v !== null && v !== "";

export default function Historico() {
  const [historico, setHistorico] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  // modal de anexo
  const [anexoOpen, setAnexoOpen] = useState(false);
  const [anexoPreview, setAnexoPreview] = useState(null); // {url, tipo, nome}

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
          collection(db, "checklists"),
          where("usuarioUid", "==", usuarioUid),
          orderBy("dataHora", "desc")
        );
        const snap = await getDocs(qRef);
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setHistorico(rows);
      } catch (err) {
        console.error("Erro ao buscar histórico:", err);
        alert("Erro ao buscar histórico.");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [navigate]);

  const toggleExpand = (id) => {
    setExpandedId((cur) => (cur === id ? null : id));
  };

  // abrir modal de anexo
  function handleOpenAnexo(anexo) {
    if (!anexo) return;
    setAnexoPreview(anexo);
    setAnexoOpen(true);
  }

  return (
    <div className="min-vh-100 d-flex flex-column align-items-center bg-dark text-light py-4 px-2">
      <div className="w-100" style={{ maxWidth: 600 }}>
        <button type="button" className="btn-voltar" onClick={() => navigate("/")}>
          ← Voltar
        </button>

        <h2 className="fw-bold mb-4 text-white">Meu Histórico</h2>

        {loading ? (
          <div className="text-secondary">Carregando...</div>
        ) : historico.length === 0 ? (
          <div className="text-secondary">Nenhum checklist encontrado.</div>
        ) : (
          historico.map((item) => {
            const data = toDateSafe(item.dataHora);
            const label = labelVeiculoHistorico(item);

            const isEmpilhadeira =
              item?.tipoSnapshot === "empilhadeira" ||
              (hasValue(item?.horimetroAtual) && !hasValue(item?.kmAtual));

            // montar lista de NOKs com descrição e anexo
            const nokEntries = Object.entries(item.respostas || {}).filter(
              ([, v]) => v === "nok"
            );

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
                      {/* Horímetro (empilhadeira) ou KM (veículo) */}
                      {isEmpilhadeira && hasValue(item.horimetroAtual) ? (
                        <div className="small text-secondary mb-2">
                          <b>Horímetro (h):</b> {item.horimetroAtual}
                        </div>
                      ) : hasValue(item.kmAtual) ? (
                        <div className="small text-secondary mb-2">
                          <b>KM:</b> {item.kmAtual}
                        </div>
                      ) : null}

                      {/* Resumo OK/NOK */}
                      <div className="mb-3">
                        <div className="fw-semibold text-dark mb-1">Itens verificados</div>
                        <ul className="row gx-2 gy-1 list-unstyled small mb-2">
                          {Object.entries(item.respostas || {}).map(([k, v]) => (
                            <li className="col-6" key={k}>
                              <span className="fw-semibold text-dark">{k}:</span>{" "}
                              <span
                                className={
                                  v === "nok" ? "text-danger fw-bold" : "text-success fw-bold"
                                }
                              >
                                {String(v).toUpperCase()}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* NOKs com descrição + anexo */}
                      {nokEntries.length > 0 && (
                        <div className="mb-2">
                          <div className="fw-semibold text-dark mb-1">
                            Problemas (NOK)
                          </div>
                          <div className="d-flex flex-column gap-2">
                            {nokEntries.map(([nomeItem]) => {
                              const desc =
                                item.descricaoNok?.[nomeItem]?.trim() || "(sem descrição)";
                              const anexo = item.anexosNok?.[nomeItem]; // {nome, tipo, url}
                              return (
                                <div
                                  key={nomeItem}
                                  className="p-2 rounded border-start border-3 border-danger bg-light"
                                >
                                  <div className="fw-semibold text-dark">{nomeItem}</div>
                                  <div className="small text-secondary">{desc}</div>
                                  {anexo?.url && (
                                    <button
                                      type="button"
                                      className="btn btn-outline-primary btn-sm mt-1"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenAnexo({
                                          url: anexo.url,
                                          tipo: anexo.tipo,
                                          nome: anexo.nome || "anexo",
                                        });
                                      }}
                                    >
                                      {anexo.tipo?.startsWith("image/")
                                        ? "Ver imagem"
                                        : anexo.tipo?.startsWith("video/")
                                        ? "Ver vídeo"
                                        : "Abrir anexo"}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Obs geral */}
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

      {/* MODAL de Anexo (imagem/vídeo) */}
      {anexoOpen && anexoPreview && (
        <div
          className="fade show"
          role="dialog"
          aria-modal="true"
          onClick={() => setAnexoOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.55)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 520, width: "100%" }}
          >
            <div
              className="modal-content rounded-4 shadow-lg"
              style={{ backgroundColor: "#fff", color: "#212529" }}
            >
              <div className="modal-header border-0 pb-0">
                <h5 className="modal-title fw-bold text-primary">
                  Visualizar anexo
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setAnexoOpen(false)}
                />
              </div>
              <div className="modal-body text-center">
                {anexoPreview.tipo?.startsWith("image/") ? (
                  <img
                    src={anexoPreview.url}
                    alt={anexoPreview.nome}
                    style={{ maxWidth: "100%", maxHeight: 380, borderRadius: 12 }}
                  />
                ) : anexoPreview.tipo?.startsWith("video/") ? (
                  <video
                    src={anexoPreview.url}
                    controls
                    style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 12 }}
                  />
                ) : (
                  <div className="small">Tipo de anexo não suportado.</div>
                )}
                <div className="small mt-2 text-secondary">{anexoPreview.nome}</div>
              </div>
              <div className="modal-footer border-0 pt-0">
                <button className="btn btn-secondary" onClick={() => setAnexoOpen(false)}>
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
