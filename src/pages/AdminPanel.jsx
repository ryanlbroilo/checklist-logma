import { useEffect, useMemo, useState } from "react";
import {
  collection, getDocs, orderBy, query,
  deleteDoc, doc, setDoc, serverTimestamp
} from "firebase/firestore";
import { db, auth } from "../services/firebase";
import { useNavigate } from "react-router-dom";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend
} from "chart.js";
import { createUserWithEmailAndPassword } from "firebase/auth";
ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const whiteBackground = {
  id: "whiteBackground",
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
};
ChartJS.register(whiteBackground);

import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logo from "../assets/logo.png";

// seção isolada de veículos e Usuários
import VeiculosSection from "../components/VeiculosSection";
import UsuariosSection from "../components/UsuariosSection";

/* ================= Helpers ================= */
async function excluirChecklist(id, setChecklists) {
  if (!window.confirm("Tem certeza que deseja excluir este checklist?")) return;
  try {
    await deleteDoc(doc(db, "checklists", id));
    setChecklists(prev => prev.filter(c => c.id !== id));
    alert("Checklist excluído com sucesso!");
  } catch (err) {
    alert("Erro ao excluir checklist: " + err.message);
  }
}
function getAnexoPreview(anexo) {
  if (!anexo) return null;
  if (anexo.url) return { url: anexo.url, tipo: anexo.tipo, nome: anexo.nome || "anexo" };
  if (anexo.base64) return { url: anexo.base64, tipo: anexo.tipo, nome: anexo.nome || "anexo" };
  return null;
}
const anoAtualStr = () => String(new Date().getFullYear());
const hojeYYYYMM = () => new Date().toISOString().slice(0, 7);
function getDateFromAny(d) {
  if (!d) return null;
  const dt = d?.toDate?.() ? d.toDate() : d;
  return dt instanceof Date ? dt : new Date(dt);
}
// mesmíssima sanitização usada em manutenção
function sanitizeFieldPath(str) {
  return String(str || "").replace(/[~*/\[\].]/g, "_");
}

/* ================= Componente ================= */
export default function AdminPanel({ role }) {
  const navigate = useNavigate();

  // dados
  const [checklists, setChecklists] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [manutencoes, setManutencoes] = useState([]);

  // visibilidade
  const [showChecklists, setShowChecklists] = useState(false);
  const [showUsuarios, setShowUsuarios] = useState(false);
  const [showVeiculos, setShowVeiculos] = useState(false);

  // filtros lista
  const [usuarioFiltro, setUsuarioFiltro] = useState("");
  const [veiculoFiltro, setVeiculoFiltro] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [baseLoaded, setBaseLoaded] = useState(false);

  // gráficos
  const [graficoSelecionado, setGraficoSelecionado] = useState("porVeiculo");
  const [formatoRelatorio, setFormatoRelatorio] = useState("xlsx");
  const [filtroPendenciasAvisos, setFiltroPendenciasAvisos] = useState("");

  // período gráfico
  const [rangeTipo, setRangeTipo] = useState("mensal"); // mensal | trimestral | semestral | anual
  const [mesGraf, setMesGraf] = useState(hojeYYYYMM()); // YYYY-MM
  const [anoGraf, setAnoGraf] = useState(anoAtualStr());
  const [trimGraf, setTrimGraf] = useState("1"); // 1..4
  const [semGraf, setSemGraf] = useState("1");  // 1..2

  // pendências (segunda/quinta)
  const [filtroPendente, setFiltroPendente] = useState("");
  const [expandirPendenciaChecklist, setExpandirPendenciaChecklist] = useState(false);

  // expand de checklist
  const [expanded, setExpanded] = useState({});

  // modal anexo
  const [anexoPreview, setAnexoPreview] = useState(null);
  const [anexoModalOpen, setAnexoModalOpen] = useState(false);

  // modal cadastro usuário
  const [cadModalOpen, setCadModalOpen] = useState(false);
  const [cadNome, setCadNome] = useState("");
  const [cadEmail, setCadEmail] = useState("");
  const [cadSenha, setCadSenha] = useState("");
  const [cadTipo, setCadTipo] = useState("motorista");
  const [cadErro, setCadErro] = useState(null);
  const [cadSucesso, setCadSucesso] = useState(null);

  /* ===== segurança ===== */
  useEffect(() => {
    if (role !== "admin") {
      alert("Acesso restrito. Você não é admin.");
      navigate("/");
    }
  }, [role, navigate]);

  /* ===== util p/ reload ===== */
  async function reloadColecao(nomeCol, setter, orderField, orderDir = "asc") {
    const q = query(collection(db, nomeCol), orderBy(orderField, orderDir));
    const snap = await getDocs(q);
    setter(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  /* ===== carregar dados ===== */
  useEffect(() => {
  (async () => {
    try {
      const [snapC, snapU, snapM] = await Promise.all([
        getDocs(query(collection(db, "checklists"), orderBy("dataHora", "desc"))),
        getDocs(query(collection(db, "usuarios"), orderBy("nome", "asc"))),
        getDocs(query(collection(db, "manutencoes"), orderBy("dataHora", "desc"))),
      ]);

      setChecklists(snapC.docs.map(d => ({ id: d.id, ...d.data() })));
      setUsuarios(snapU.docs.map(d => ({ id: d.id, ...d.data() })));
      setManutencoes(snapM.docs.map(d => ({ id: d.id, ...d.data() })));
    } finally {
      setBaseLoaded(true);
    }
  })();
}, []);

  // nomes de veículos/equipamentos/geradores (derivado dos checklists) para filtros
  const veiculoNomes = useMemo(() => {
    return [...new Set(checklists.map(item => item.selecionadoNome).filter(Boolean))].sort();
  }, [checklists]);

  // pendências que já possuem manutenção vinculada (qualquer status)
  const manutencoesVinculadasSet = useMemo(() => {
   const s = new Set();
   manutencoes.forEach(m => {
     const info = m.problemaVinculadoInfo;
     if (info?.checklistId && info?.nomeItem) {
      s.add(`${info.checklistId}:${info.nomeItem}`);
    }
  });
  return s;
  }, [manutencoes]);

  /* ===== pendências segunda/quinta ===== */
  function getUltimoDiaAlvo() {
    const hoje = new Date();
    const dia = hoje.getDay(); // 0..6 (0=dom)
    if (dia === 1 || dia === 4) {
      return new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    }
    const ref = new Date(hoje);
    ref.setDate(hoje.getDate() - (dia >= 4 ? dia - 4 : dia - 1));
    return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  }
  function mesmoDia(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  const diaAlvo = getUltimoDiaAlvo();
  const usuariosObrigados = usuarios.filter(u =>
    ["motorista", "operador_empilhadeira", "operador_gerador"].includes(u.role)
  );
  function ultimoChecklistUsuario(nomeUsuario) {
    const cs = checklists.filter(c => c.usuarioNome === nomeUsuario);
    if (cs.length === 0) return null;
    const c = cs[0];
    let data = c.dataHora?.toDate?.() || c.dataHora;
    if (typeof data === "string") data = new Date(data);
    else if (data && data.seconds) data = new Date(data.seconds * 1000);
    return data;
  }
  const usuariosPendentes = usuariosObrigados
    .filter(u => {
      const fezChecklist = checklists.some(c => {
        if (c.usuarioNome !== u.nome) return false;
        let data = c.dataHora?.toDate?.() || c.dataHora;
        if (typeof data === "string") data = new Date(data);
        else if (data && data.seconds) data = new Date(data.seconds * 1000);
        if (!data) return false;
        return mesmoDia(data, diaAlvo);
      });
      return !fezChecklist;
    })
    .map(u => ({ ...u, ultimoChecklist: ultimoChecklistUsuario(u.nome) }))
    .filter(u => !filtroPendente || u.nome === filtroPendente);

  /* ===== filtros da LISTA de checklists ===== */
  const filteredChecklists = checklists.filter(item => {
    const matchesUsuario = usuarioFiltro ? item.usuarioNome === usuarioFiltro : true;
    const matchesVeiculo = veiculoFiltro ? item.selecionadoNome === veiculoFiltro : true;
    let matchesData = true;
    if (dataInicio) {
      const data = getDateFromAny(item.dataHora);
      matchesData = data && data >= new Date(dataInicio);
    }
    if (matchesData && dataFim) {
      const data = getDateFromAny(item.dataHora);
      matchesData = data && data <= new Date(dataFim + "T23:59:59");
    }
    return matchesUsuario && matchesVeiculo && matchesData;
  });

  /* ===== dados p/ gráficos (obedecem período selecionado) ===== */
  const checklistsPeriodo = useMemo(() => {
    const arr = Array.isArray(checklists) ? checklists : [];
    const now = new Date();
    const y = parseInt(anoGraf || String(now.getFullYear()), 10);

    if (rangeTipo === "mensal") {
      const [yy, mm] = mesGraf.split("-").map(Number);
      return arr.filter(r => {
        const dt = getDateFromAny(r.dataHora);
        return dt && dt.getFullYear() === yy && (dt.getMonth() + 1) === mm;
      });
    }
    if (rangeTipo === "trimestral") {
      const q = parseInt(trimGraf, 10); // 1..4
      const startMonth = (q - 1) * 3; // 0,3,6,9
      const endMonth = startMonth + 2; // 2,5,8,11
      return arr.filter(r => {
        const dt = getDateFromAny(r.dataHora);
        return dt && dt.getFullYear() === y && dt.getMonth() >= startMonth && dt.getMonth() <= endMonth;
      });
    }
    if (rangeTipo === "semestral") {
      const s = parseInt(semGraf, 10); // 1..2
      const startMonth = s === 1 ? 0 : 6;
      const endMonth = s === 1 ? 5 : 11;
      return arr.filter(r => {
        const dt = getDateFromAny(r.dataHora);
        return dt && dt.getFullYear() === y && dt.getMonth() >= startMonth && dt.getMonth() <= endMonth;
      });
    }
    // anual
    return arr.filter(r => {
      const dt = getDateFromAny(r.dataHora);
      return dt && dt.getFullYear() === y;
    });
  }, [checklists, rangeTipo, mesGraf, anoGraf, trimGraf, semGraf]);

  const checklistsPorVeiculo = useMemo(() => {
    const acc = {};
    checklistsPeriodo.forEach(item => {
      const nome = item.selecionadoNome || "Outros";
      acc[nome] = (acc[nome] || 0) + 1;
    });
    return acc;
  }, [checklistsPeriodo]);

  const problemasPorItem = useMemo(() => {
    const acc = {};
    checklistsPeriodo.forEach(item => {
      if (item.respostas) {
        Object.entries(item.respostas).forEach(([nomeItem, valor]) => {
          if (valor === "nok") {
            if (!filtroPendenciasAvisos || item.selecionadoNome === filtroPendenciasAvisos) {
              acc[nomeItem] = (acc[nomeItem] || 0) + 1;
            }
          }
        });
      }
    });
    return acc;
  }, [checklistsPeriodo, filtroPendenciasAvisos]);

  const barData = {
    labels: Object.keys(checklistsPorVeiculo),
    datasets: [{
      label: "Qtd. Checklists por veículo",
      data: Object.values(checklistsPorVeiculo),
      backgroundColor: "rgba(0,150,255,.65)",
      borderColor: "rgba(0,150,255,1)",
      borderWidth: 2,
      borderRadius: 8,
      hoverBackgroundColor: "rgba(0,150,255,.85)"
    }]
  };
  const chartOptions = {
    plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
    maintainAspectRatio: false,
    interaction: { mode: "nearest", axis: "x", intersect: false },
    scales: {
      x: { grid: { color: "rgba(0,0,0,.06)" }, ticks: { color: "#333", maxRotation: 0, minRotation: 0 } },
      y: { grid: { color: "rgba(0,0,0,.06)" }, ticks: { color: "#333", precision: 0 } }
    }
  };
  const manutKeys = useMemo(() => {
    const s = new Set();
    manutencoes.forEach(m => {
      const info = m.problemaVinculadoInfo;
      if (info && info.checklistId && info.nomeItem) {
        s.add(`${info.checklistId}:${info.nomeItem}`);
      }
    });
    return s;
  }, [manutencoes]);

  /* ===== pendências painel lateral (com filtro por manutenção vinculada) ===== */
  let problemasChecklist = [];
checklists.forEach(item => {
  if (item.descricaoNok && typeof item.descricaoNok === "object") {
    Object.entries(item.descricaoNok).forEach(([nomeItem, desc]) => {
      const jaVinculada = manutencoesVinculadasSet.has(`${item.id}:${nomeItem}`);
      const marcadoNoChecklist = Boolean(item.problemasVinculados?.[nomeItem]);
      if (
        desc && desc.trim() &&
        item.respostas?.[nomeItem] === "nok" &&
        !marcadoNoChecklist &&          
        !jaVinculada &&                 
        (!filtroPendenciasAvisos || item.selecionadoNome === filtroPendenciasAvisos)
      ) {
        problemasChecklist.push({
          checklistId: item.id,
          item: nomeItem,
          desc,
          veiculo: item.selecionadoNome || "-",
          dataHora: (item.dataHora && typeof item.dataHora.toDate === "function")
            ? item.dataHora.toDate().toLocaleString()
            : "-",
          anexo: item.anexosNok?.[nomeItem] ? getAnexoPreview(item.anexosNok[nomeItem]) : null
        });
      }
    });
  }
});
const problemasUnicos = problemasChecklist;

  function gerarRelatorio() {
    let data;
    if (graficoSelecionado === "porVeiculo") {
      data = Object.entries(checklistsPorVeiculo).map(([nome, qtd]) => ({ Veiculo: nome, "Qtd. Checklists": qtd }));
    } else {
      data = Object.entries(problemasPorItem).map(([item, qtd]) => ({ Item: item, "Qtd. de Problemas (NOK)": qtd }));
    }
    if (formatoRelatorio === "xlsx") {
      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [{ wch: 30 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Relatório");
      XLSX.writeFile(wb, graficoSelecionado === "porVeiculo" ? "relatorio_checklists.xlsx" : "relatorio_itens_problematicos.xlsx");
    } else {
      const pdf = new jsPDF();
      pdf.text(graficoSelecionado === "porVeiculo" ? "Relatório - Checklists por Veículo" : "Relatório - Itens Problemáticos", 14, 14);
      autoTable(pdf, {
        startY: 20,
        head: [graficoSelecionado === "porVeiculo" ? ["Veículo", "Qtd. Checklists"] : ["Item", "Qtd. de Problemas (NOK)"]],
        body: data.map(d => graficoSelecionado === "porVeiculo" ? [d.Veiculo, d["Qtd. Checklists"]] : [d.Item, d["Qtd. de Problemas (NOK)"]]),
        styles: { fontSize: 12 }, headStyles: { fillColor: [13, 110, 253] }
      });
      pdf.save(graficoSelecionado === "porVeiculo" ? "relatorio_checklists.pdf" : "relatorio_itens_problematicos.pdf");
    }
  }

  function renderDataHora(dataHora) {
    return (dataHora && typeof dataHora.toDate === "function") ? dataHora.toDate().toLocaleString() : "-";
  }
  function renderResposta(v) { return typeof v === "string" ? v.toUpperCase() : "-"; }
  const toggleExpand = (id) => setExpanded(exp => ({ ...exp, [id]: !exp[id] }));

  /* =================== RENDER =================== */
  return (
    <div className="min-vh-100 d-flex flex-column align-items-center bg-dark text-light py-4 px-2">
      {/* MODAL ANEXO */}
      {anexoModalOpen && anexoPreview && (
        <div className="modal fade show" style={{ display: "block", background: "rgba(0,0,0,.5)", position: "fixed", inset: 0, zIndex: 1060 }}
             tabIndex="-1" aria-modal="true" role="dialog" onClick={() => setAnexoModalOpen(false)}>
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-content rounded-4 shadow-lg">
              <div className="modal-header border-0 pb-0">
                <h5 className="modal-title fw-bold text-primary">Visualizar Anexo</h5>
                <button type="button" className="btn-close" onClick={() => setAnexoModalOpen(false)} />
              </div>
              <div className="modal-body text-center">
                {anexoPreview.tipo?.startsWith("image/") ? (
                  <img src={anexoPreview.url} alt={anexoPreview.nome} style={{ maxWidth: "100%", maxHeight: 350, borderRadius: 12 }} />
                ) : anexoPreview.tipo?.startsWith("video/") ? (
                  <video src={anexoPreview.url} controls style={{ maxWidth: "100%", maxHeight: 350, borderRadius: 12 }} />
                ) : (<span>Tipo de anexo não suportado.</span>)}
                <div className="small mt-2">{anexoPreview.nome}</div>
              </div>
              <div className="modal-footer border-0 pt-0">
                <button className="btn btn-secondary" onClick={() => setAnexoModalOpen(false)}>Fechar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CAD USUÁRIO */}
      {cadModalOpen && (
        <div className="modal fade show" tabIndex="-1"
             style={{ display: "block", background: "rgba(0,0,0,.5)", position: "fixed", inset: 0, zIndex: 1070 }}
             aria-modal="true" role="dialog" onClick={() => setCadModalOpen(false)}>
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-content rounded-4 shadow-lg">
              <div className="modal-header border-0 pb-0">
                <h5 className="modal-title fw-bold text-primary">Cadastrar Usuário</h5>
                <button type="button" className="btn-close" onClick={() => setCadModalOpen(false)} />
              </div>
              <div className="modal-body p-3">
                <div className="text-center mb-3">
                  <img src={logo} alt="Logma Transportes" style={{ width: 70, height: 70, objectFit: "contain", filter: "drop-shadow(2px 2px 6px rgba(0,0,0,.3))" }} />
                </div>
                {cadErro && <div className="alert alert-danger text-center py-2">{cadErro}</div>}
                {cadSucesso && <div className="alert alert-success text-center py-2">{cadSucesso}</div>}
                <form onSubmit={async (e) => {
                  e.preventDefault(); setCadErro(null); setCadSucesso(null);
                  try {
                    const cred = await createUserWithEmailAndPassword(auth, cadEmail, cadSenha);
                    await setDoc(doc(db, "usuarios", cred.user.uid), { nome: cadNome, email: cadEmail, role: cadTipo, criadoEm: serverTimestamp() });
                    setCadSucesso("Usuário cadastrado com sucesso!");
                    setCadNome(""); setCadEmail(""); setCadSenha(""); setCadTipo("motorista");
                    await reloadColecao("usuarios", setUsuarios, "nome", "asc");
                    setTimeout(() => setCadModalOpen(false), 1200);
                  } catch (error) {
                    if (error.code === "auth/email-already-in-use") setCadErro("E-mail já cadastrado.");
                    else if (error.code === "auth/weak-password") setCadErro("Senha muito fraca. Use pelo menos 6 caracteres.");
                    else setCadErro("Erro ao criar conta. Verifique os campos e tente novamente.");
                  }
                }}>
                  <div className="mb-3">
                    <input type="text" placeholder="Nome" value={cadNome} onChange={e => setCadNome(e.target.value)}
                           className="form-control form-control-lg" required autoFocus />
                  </div>
                  <div className="mb-3">
                    <input type="email" placeholder="E-mail" value={cadEmail} onChange={e => setCadEmail(e.target.value)}
                           className="form-control form-control-lg" required />
                  </div>
                  <div className="mb-3">
                    <input type="password" placeholder="Senha" value={cadSenha} onChange={e => setCadSenha(e.target.value)}
                           className="form-control form-control-lg" required />
                  </div>
                  <div className="mb-4">
                    <select value={cadTipo} onChange={e => setCadTipo(e.target.value)} className="form-select form-select-lg" required>
                      <option value="motorista">Motorista</option>
                      <option value="operador_empilhadeira">Operador de Empilhadeira</option>
                      <option value="operador_gerador">Operador de Gerador</option>
                    </select>
                  </div>
                  <button type="submit" className="btn btn-primary btn-lg w-100 fw-bold" disabled={!!cadSucesso}>Registrar</button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* topo */}
      <div className="w-100" style={{ maxWidth: 1200 }}>
        <button type="button" className="btn-voltar" onClick={() => navigate("/")}>← Voltar</button>
        <h2 className="fw-bold mb-4 text-center text-white">Painel de Admin</h2>

        {/* PAINEL: Pendência de Checklist */}
        <div className="card bg-danger text-white mb-4">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="card-title fw-bold mb-0">Pendência de Checklist</h5>
              <select className="form-select form-select-sm w-auto bg-light text-dark"
                      value={filtroPendente} onChange={e => setFiltroPendente(e.target.value)}
                      style={{ minWidth: 160, display: "inline-block" }}>
                <option value="">Todos os usuários</option>
                {usuariosPendentes.map(u => (<option key={u.nome} value={u.nome}>{u.nome}</option>))}
              </select>
            </div>
            {usuariosPendentes.length === 0 ? (
              <div>Todos os usuários obrigatórios realizaram o checklist na última segunda ou quinta.</div>
            ) : (
              <>
                <ul className="mb-0">
                  {(expandirPendenciaChecklist ? usuariosPendentes : usuariosPendentes.slice(0, 5)).map((u, idx) => (
                    <li key={idx}>
                      <strong>{u.nome}</strong> ({u.role})<br />
                      <span className="small">
                        Último checklist:{" "}
                        {u.ultimoChecklist
                          ? u.ultimoChecklist.toLocaleString("pt-BR", {
                              weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
                            })
                          : <span className="text-warning">Nunca fez</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                {usuariosPendentes.length > 5 && (
                  <div className="text-center mt-2">
                    <button className="btn btn-outline-light btn-sm" onClick={() => setExpandirPendenciaChecklist(e => !e)}>
                      {expandirPendenciaChecklist ? "Mostrar menos" : `Mostrar todos (${usuariosPendentes.length})`}
                    </button>
                  </div>
                )}
              </>
            )}
            <div className="mt-2 small">* Apenas motoristas e operadores aparecem aqui, checando segunda/quinta mais recente.</div>
            <div className="small">Dia referência: {diaAlvo.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}</div>
          </div>
        </div>

        {/* DASHBOARD: GRÁFICO + PENDÊNCIAS */}
        <div className="row g-4 mb-5">
          {/* Gráfico */}
          <div className="col-md-8 d-flex flex-column">
            <div className="card bg-white text-dark border-0 shadow flex-fill h-100">
              <div className="card-body d-flex flex-column h-100">
                <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
                  <h5 className="card-title fw-bold mb-0">
                    {graficoSelecionado === "porVeiculo" ? "Checklists Realizados por Veículo" : "Itens do Checklist Mais Problemáticos"}
                  </h5>

                  <div className="d-flex flex-wrap align-items-center gap-2 ms-auto">
                    <select className="form-select w-auto" value={rangeTipo} onChange={e => setRangeTipo(e.target.value)} title="Período">
                      <option value="mensal">Mensal</option>
                      <option value="trimestral">Trimestral</option>
                      <option value="semestral">Semestral</option>
                      <option value="anual">Anual</option>
                    </select>

                    {rangeTipo === "mensal" && (
                      <input type="month" className="form-control" style={{ maxWidth: 180 }} value={mesGraf} onChange={(e) => setMesGraf(e.target.value)} title="Mês" />
                    )}
                    {rangeTipo === "trimestral" && (
                      <>
                        <select className="form-select w-auto" value={trimGraf} onChange={(e) => setTrimGraf(e.target.value)} title="Trimestre">
                          <option value="1">1º Tri (Jan–Mar)</option><option value="2">2º Tri (Abr–Jun)</option>
                          <option value="3">3º Tri (Jul–Set)</option><option value="4">4º Tri (Out–Dez)</option>
                        </select>
                        <input type="number" className="form-control" style={{ width: 110 }} value={anoGraf} onChange={(e) => setAnoGraf(e.target.value)} title="Ano" />
                      </>
                    )}
                    {rangeTipo === "semestral" && (
                      <>
                        <select className="form-select w-auto" value={semGraf} onChange={(e) => setSemGraf(e.target.value)} title="Semestre">
                          <option value="1">1º Sem (Jan–Jun)</option><option value="2">2º Sem (Jul–Dez)</option>
                        </select>
                        <input type="number" className="form-control" style={{ width: 110 }} value={anoGraf} onChange={(e) => setAnoGraf(e.target.value)} title="Ano" />
                      </>
                    )}
                    {rangeTipo === "anual" && (
                      <input type="number" className="form-control" style={{ width: 110 }} value={anoGraf} onChange={(e) => setAnoGraf(e.target.value)} title="Ano" />
                    )}

                    <select className="form-select w-auto" value={graficoSelecionado} onChange={e => setGraficoSelecionado(e.target.value)}>
                      <option value="porVeiculo">Por Veículo</option>
                      <option value="problemas">Itens Problemáticos</option>
                    </select>
                    <select className="form-select w-auto" value={formatoRelatorio} onChange={e => setFormatoRelatorio(e.target.value)}>
                      <option value="xlsx">Excel (XLSX)</option>
                      <option value="pdf">PDF</option>
                    </select>
                    <button className="btn btn-success fw-bold" onClick={gerarRelatorio} type="button">Gerar Relatório</button>
                  </div>
                </div>

                <div style={{ minHeight: 320, flex: 1 }}>
                  {graficoSelecionado === "porVeiculo" ? (
                    Object.keys(checklistsPorVeiculo).length === 0
                      ? <div className="text-center text-secondary">Sem dados no período selecionado</div>
                      : <Bar data={barData} options={chartOptions} />
                  ) : (
                    Object.keys(problemasPorItem).length === 0
                      ? <div className="text-center text-secondary">Nenhum problema no período selecionado</div>
                      : <Bar data={{
                          labels: Object.keys(problemasPorItem),
                          datasets: [{
                            label: "Qtd. de Problemas (NOK)",
                            data: Object.values(problemasPorItem),
                            backgroundColor: "rgba(255,80,120,.65)",
                            borderColor: "rgba(255,80,120,1)",
                            borderWidth: 2,
                            borderRadius: 8,
                            hoverBackgroundColor: "rgba(255,80,120,.85)"
                          }]
                        }} options={chartOptions} />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Card pendências ao lado */}
          <div className="col-md-4 d-flex flex-column">
            <div className="card shadow border-0 flex-fill h-100 d-flex flex-column">
              <div className="card-body d-flex flex-column h-100 p-3">
                <div className="d-flex align-items-center mb-2 gap-2">
                  <span className="badge bg-danger me-2" style={{ fontSize: 18, minWidth: 36 }}>{problemasUnicos.length}</span>
                  <span className="fw-bold">Pendências</span>
                  <select className="form-select form-select-sm w-auto ms-auto"
                          value={filtroPendenciasAvisos} onChange={e => setFiltroPendenciasAvisos(e.target.value)}
                          style={{ minWidth: 180, display: "inline-block" }}>
                    <option value="">Todos os veículos/equipamentos</option>
                    {veiculoNomes.map(nome => (
                      <option key={nome} value={nome}>{nome}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minHeight: 200, maxHeight: 400, overflowY: "auto", marginBottom: 10 }}>
                   {!baseLoaded ? (
                <div className="text-secondary">Carregando pendências…</div>
                       ) : problemasUnicos.length === 0 ? (
                     <div className="text-secondary">Nenhum problema pendente</div>
                    ) : (
                    problemasUnicos.map((p, idx) => (
                      <div key={idx} className="mb-2 border-start border-danger ps-2">
                        <span className="fw-bold">{p.item}</span>: <span className="text-danger">{p.desc}</span>
                        <div className="small text-secondary"><span className="fw-bold">{p.veiculo}</span> {p.dataHora}</div>
                        {p.anexo?.url && (
                          <button className="btn btn-outline-primary btn-sm mt-1"
                                  style={{ fontSize: 13, padding: "2px 8px", borderRadius: 8 }}
                                  onClick={() => { setAnexoPreview(p.anexo); setAnexoModalOpen(true); }}
                          >
                            {p.anexo.tipo?.startsWith("image/") ? "Abrir imagem" : p.anexo.tipo?.startsWith("video/") ? "Ver vídeo" : "Abrir anexo"}
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                <div className="text-center small text-secondary mt-1" style={{ opacity: .85 }}>* Resolva no painel de manutenções</div>
              </div>
            </div>
          </div>
        </div>

        {/* Botões de alternância */}
        <div className="mb-4 d-flex flex-wrap gap-2 justify-content-center">
          <button className="btn btn-primary fw-bold" onClick={() => setShowChecklists(v => !v)}>
            {showChecklists ? "Ocultar Checklists" : "Todos os Checklists"}
          </button>
          <button className="btn btn-primary fw-bold" onClick={() => setShowUsuarios(v => !v)}>
            {showUsuarios ? "Ocultar Usuários" : "Usuários Cadastrados"}
          </button>
          <button className="btn btn-primary fw-bold" onClick={() => setShowVeiculos(v => !v)}>
            {showVeiculos ? "Ocultar Veículos" : "Veículos Cadastrados"}
          </button>
        </div>

        {/* LISTA DE CHECKLISTS */}
        {showChecklists && (
          <div className="card bg-light text-dark shadow border-0 mb-5">
            <div className="card-body">
              <h5 className="card-title fw-bold text-primary mb-3 d-flex align-items-center">
                Checklists
                <span className="badge bg-primary ms-2">{filteredChecklists.length}</span>
              </h5>
              <div className="row g-2 mb-3">
                <div className="col-md-3">
                  <label className="form-label mb-1">Data Início</label>
                  <input type="date" className="form-control" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
                </div>
                <div className="col-md-3">
                  <label className="form-label mb-1">Data Fim</label>
                  <input type="date" className="form-control" value={dataFim} onChange={e => setDataFim(e.target.value)} />
                </div>
                <div className="col-md-3">
                  <label className="form-label mb-1 d-none d-md-block">&nbsp;</label>
                  <select className="form-select" value={usuarioFiltro} onChange={e => setUsuarioFiltro(e.target.value)}>
                    <option value="">Selecione um usuário</option>
                    {usuarios.map((u) => (<option key={u.id} value={u.nome}>{u.nome}</option>))}
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label mb-1 d-none d-md-block">&nbsp;</label>
                  <select className="form-select" value={veiculoFiltro} onChange={e => setVeiculoFiltro(e.target.value)}>
                    <option value="">Selecione um veículo/equipamento</option>
                    {veiculoNomes.map((nome) => (<option key={nome} value={nome}>{nome}</option>))}
                  </select>
                </div>
              </div>

              {filteredChecklists.length === 0 ? (
                <div className="text-center text-secondary">Nenhum checklist encontrado.</div>
              ) : (
                filteredChecklists.map((item) => (
                  <div key={item.id}>
                    <div
                      className="mb-2 p-2 rounded bg-white d-flex justify-content-between align-items-center"
                      style={{ cursor: "pointer", border: "1px solid #eaeaea" }}
                      onClick={() => setExpanded(exp => ({ ...exp, [item.id]: !exp[item.id] }))}
                    >
                      <div>
                        <span className="fw-bold">{item.usuarioNome || item.motorista}</span> -{" "}
                        <span className="fw-bold">{item.selecionadoNome || item.veiculo || item.empilhadeira || item.gerador}</span>
                      </div>
                      <div className="small text-secondary d-flex align-items-center gap-2">
                     {(
                      item?.tipoSnapshot === "empilhadeira" || (item?.horimetroAtual ?? null) !== null
                       ) ? (
                      <>H: {item.horimetroAtual ?? "-"} | {renderDataHora(item.dataHora)}</>
                       ) : (
                        <>KM: {item.kmAtual ?? "-"} | {renderDataHora(item.dataHora)}</>
                       )}
                        <button
                        className="btn btn-sm btn-outline-danger ms-2"
                          title="Excluir checklist"
                           onClick={e => { e.stopPropagation(); excluirChecklist(item.id, setChecklists); }}
                         >
                        Excluir
                      </button>
                     </div>
                    </div>
                    {expanded[item.id] && (
                      <div className="bg-light border-start border-3 border-primary mb-3 px-3 py-2">
                        <ul className="small mb-0">
                          {item.respostas && Object.entries(item.respostas).map(([k, v]) => (
                            <li key={k}>
                              <span className="fw-semibold">{k}</span>:{" "}
                              <span className={v === "ok" ? "text-success" : v === "nok" ? "text-danger" : "text-secondary"}>
                                {renderResposta(v)}
                              </span>
                              {item.anexosNok?.[k] && (
                                <button
                                  className="btn btn-outline-primary btn-sm ms-2"
                                  style={{ fontSize: 13, padding: "2px 8px", borderRadius: 8 }}
                                  onClick={() => { setAnexoPreview(getAnexoPreview(item.anexosNok[k])); setAnexoModalOpen(true); }}
                                >
                                  {item.anexosNok[k].tipo?.startsWith("image/") ? "Abrir imagem" :
                                   item.anexosNok[k].tipo?.startsWith("video/") ? "Ver vídeo" : "Abrir anexo"}
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                        {item.obs && <div className="mt-2 fst-italic"><b>Obs:</b> {item.obs}</div>}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* USUÁRIOS CADASTRADOS */}
        {showUsuarios && (
          <UsuariosSection
            usuariosExternos={usuarios}
            onReload={() => reloadColecao("usuarios", setUsuarios, "nome", "asc")}
          />
        )}

        {/* VEÍCULOS CADASTRADOS */}
        {showVeiculos && (
          <VeiculosSection />
        )}
      </div>
    </div>
  );
}
