import { useEffect, useState, useCallback, useMemo, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  getDocs,
  orderBy,
  query,
  addDoc,
  updateDoc,
  doc,
  limit,
  where
} from "firebase/firestore";
import { db } from "../services/firebase";
import { useNavigate } from "react-router-dom";

// 🚗 serviços de veículos (novo)
import {
  getVeiculoById,
  marcarEmManutencao,
  marcarAtivo,
} from "../services/veiculos";

/* ===================== Utils ===================== */
function formatDate(dt) {
  if (!dt) return "-";
  if (typeof dt.toDate === "function") dt = dt.toDate();
  return new Date(dt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const filtraPorData = (manut, dataInicio, dataFim) => {
  if (!dataInicio && !dataFim) return true;
  const dt = manut.dataHora?.toDate?.() ? manut.dataHora.toDate() : manut.dataHora;
  if (dataInicio && new Date(dt) < new Date(dataInicio)) return false;
  if (dataFim && new Date(dt) > new Date(dataFim + "T23:59:59")) return false;
  return true;
};

// Sanitize para Firestore field paths
function sanitizeFieldPath(str) {
  return (str || "").replace(/[~*/\[\].]/g, "_");
}

// Converte "0006577" -> 6577
function parseKm(val) {
  if (val == null) return 0;
  const n = parseInt(String(val).replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

// Normaliza placa
function normPlaca(p) {
  return String(p || "").toUpperCase().replace(/\s|-/g, "").trim();
}

const INTERVALO = {
  motor: 15000,
  diferencial: 9000,
  caixa: 70000,
};

/* ===== datas (empilhadeiras por tempo) ===== */
const DEFAULT_BASE = new Date("2025-04-15T00:00:00"); // 15/04/2025
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Ajuste para meses com menos dias
  if (d.getDate() < day) d.setDate(0);
  return d;
}
// ⚠️ Mantida por compatibilidade, mas não usamos para cálculo de vencido.
function nextOccurrence(baseDate, intervalMonths, afterDate = new Date()) {
  let n = new Date(baseDate);
  while (n <= afterDate) {
    n = addMonths(n, intervalMonths);
  }
  return n;
}
function diffDays(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  const d1 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const d2 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((d1 - d2) / MS);
}

/**
 * Último KM por placa (normalizada) a partir de checklists recentes.
 */
async function buildMapaUltimoKmPorPlaca(maxDocs = 50) {
  const qCheck = query(
    collection(db, "checklists"),
    orderBy("dataHora", "desc"),
    limit(maxDocs)
  );
  const snap = await getDocs(qCheck);
  const mapa = new Map(); // placaNorm -> { km: number, data: Date }

  for (const d of snap.docs) {
    const c = d.data();
    // ⚠️ novo padrão: usamos snapshots; fallback para selecionadoDescricao antigo
    const placaRaw = c.placaSnapshot || c.selecionadoDescricao || "";
    const placaNorm = normPlaca(placaRaw);
    if (!placaNorm) continue;

    if (!mapa.has(placaNorm)) {
      const km = parseKm(c.kmAtual ?? c?.descricaoNok?.kmAtual);
      const dt = c.dataHora?.toDate?.() ? c.dataHora.toDate() : new Date(c.dataHora || Date.now());
      mapa.set(placaNorm, { km, data: dt });
    }
  }
  return mapa;
}

/* ===== helpers locais ===== */
const labelVeiculo = (v) => {
  const f = String(v.frotaNumero || "").trim();
  const p = String(v.placa || "").trim();
  return [f, p].filter(Boolean).join(" — ") || v.nome || "(sem identificação)";
};
/* ================================================= */

export default function Manutencao({ user }) {
  const [manutencoes, setManutencoes] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [empilhadeiras, setEmpilhadeiras] = useState([]);
  const [paleteiras, setPaleteiras] = useState([]);
  const [geradores, setGeradores] = useState([]);

  const [aba, setAba] = useState("abertas");
  const [veiculoFiltro, setVeiculoFiltro] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [carregando, setCarregando] = useState(true);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [tipo, setTipo] = useState("");
  const [equipamentoTipo, setEquipamentoTipo] = useState("");
  const [listaEquipamentos, setListaEquipamentos] = useState([]);
  const [veiculoNome, setVeiculoNome] = useState("");
  const [selectedVeiculoId, setSelectedVeiculoId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [dataPrevista, setDataPrevista] = useState("");
  const [problemaVinculado, setProblemaVinculado] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Problemas abertos (checklists NOK + avisos óleo + avisos empilhadeiras tempo)
  const [problemasAbertos, setProblemasAbertos] = useState([]);
  const [avisos, setAvisos] = useState([]); // óleo (km)
  const [avisosEmp, setAvisosEmp] = useState([]); // empilhadeiras por tempo (com data prevista)

  const navigate = useNavigate();

  /* ============ Carga base (retorna os dados também) ============ */
  const fetchBase = useCallback(async () => {
    const [mansnap, veicsnap, empisnap, palsnap, gersnap, checksnap] = await Promise.all([
      getDocs(query(collection(db, "manutencoes"), orderBy("dataHora", "desc"))),
      getDocs(query(collection(db, "veiculos"), orderBy("nome", "asc"))),
      getDocs(query(collection(db, "empilhadeiras"), orderBy("nome", "asc"))),
      getDocs(query(collection(db, "paleteiras"), orderBy("nome", "asc"))),
      getDocs(query(collection(db, "geradores"), orderBy("nome", "asc"))),
      getDocs(query(collection(db, "checklists"), orderBy("dataHora", "desc")))
    ]);

    const manutencoesList = mansnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const veiculosList = veicsnap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, displayLabel: labelVeiculo(data) };
    });
    const empilhadeirasList = empisnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const paleteirasList = palsnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const geradoresList = gersnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Problemas de checklist (NOK não vinculados)
    const manutVinculando = manutencoesList
      .filter(m => (m.status === "aberta" || m.status === "pendente") && m.problemaVinculadoInfo)
      .map(m => m.problemaVinculadoInfo);

    const problemasEmManutencao = new Set(
      manutVinculando.filter(Boolean).map(info => `${info.checklistId}:${info.nomeItem}`)
    );

    let abertos = [];
    checksnap.docs.forEach(d => {
      const c = d.data();
      if (c.descricaoNok && typeof c.descricaoNok === "object") {
        Object.entries(c.descricaoNok).forEach(([nomeItem, desc]) => {
          if (
            desc && desc.trim() &&
            c.respostas?.[nomeItem] === "nok" &&
            !(c.problemasVinculados && c.problemasVinculados[sanitizeFieldPath(nomeItem)]) &&
            !problemasEmManutencao.has(`${d.id}:${nomeItem}`)
          ) {
            abertos.push({
              checklistId: d.id,
              nomeItem,
              desc,
              veiculo: c.placaSnapshot || c.selecionadoNome || "-",
              dataHora: c.dataHora,
            });
          }
        });
      }
    });

    // Atualiza estados visuais
    setManutencoes(manutencoesList);
    setVeiculos(veiculosList);
    setEmpilhadeiras(empilhadeirasList);
    setPaleteiras(paleteirasList);
    setGeradores(geradoresList);
    setProblemasAbertos(abertos);

    // Retorna para quem chamar usar imediatamente (evita esperar o próximo render)
    return {
      manutencoesList,
      veiculosList,
      empilhadeirasList,
      paleteirasList,
      geradoresList,
      problemasAbertosList: abertos,
    };
  }, []);

  /* ============ Avisos (últimos KMs + parâmetros) ============ */
  const computeAvisos = useCallback(async () => {
    try {
      const mapaUltimosKms = await buildMapaUltimoKmPorPlaca(50);
      const parametrosSnap = await getDocs(collection(db, "parametros_manutencao"));

      const avisosLocal = [];
      const updates = [];
      const avisosParaModal = [];

      const pushAviso = (placaStr, tipoKey, kmFalt) => {
        const tipoLabel =
          tipoKey === "motor" ? "Óleo do Motor" :
          tipoKey === "diferencial" ? "Óleo do Diferencial" :
          "Óleo da Caixa";

        if (kmFalt !== null && kmFalt <= 500) {
          avisosLocal.push({
            placa: placaStr,
            tipoOleo: tipoKey,
            kmFaltante: kmFalt,
            desc: `${tipoLabel}: ${kmFalt} km faltando`
          });

          avisosParaModal.push({
            checklistId: "manut-prev",
            nomeItem: tipoLabel,
            desc: `${tipoLabel}: ${kmFalt} km`,
            veiculo: placaStr,
            tipoOleo: tipoKey,
            dataHora: new Date(),
          });
        }
      };

      for (let docSnap of parametrosSnap.docs) {
        const v = docSnap.data();
        const id = docSnap.id;
        const placaRaw = (v.placa || v.PLACA || id || "").trim();
        const placaNorm = normPlaca(placaRaw);
        if (!placaNorm) continue;

        const ultimoFromMapa = mapaUltimosKms.get(placaNorm);
        let kmAtual = parseKm(v.kmAtual);
        if (ultimoFromMapa && ultimoFromMapa.km > kmAtual) {
          kmAtual = ultimoFromMapa.km;
        }

        const motorProx = parseKm(v?.motor?.kmProximaTroca);
        const difProx   = parseKm(v?.diferencial?.kmProximaTroca);
        const caixaProx = parseKm(v?.caixa?.kmProximaTroca);

        const kmFaltMotor = Number.isFinite(motorProx) && motorProx > 0 ? Math.max(motorProx - kmAtual, 0) : null;
        const kmFaltDif   = Number.isFinite(difProx)   && difProx   > 0 ? Math.max(difProx   - kmAtual, 0) : null;
        const kmFaltCaixa = Number.isFinite(caixaProx) && caixaProx > 0 ? Math.max(caixaProx - kmAtual, 0) : null;

        const upd = {};
        let precisaUpdate = false;

        if (kmAtual !== parseKm(v.kmAtual)) { upd.kmAtual = kmAtual; precisaUpdate = true; }
        if (kmFaltMotor !== null && kmFaltMotor !== v?.motor?.kmFaltante) {
          upd["motor.kmFaltante"] = kmFaltMotor; precisaUpdate = true;
        }
        if (kmFaltDif !== null && kmFaltDif !== v?.diferencial?.kmFaltante) {
          upd["diferencial.kmFaltante"] = kmFaltDif; precisaUpdate = true;
        }
        if (kmFaltCaixa !== null && kmFaltCaixa !== v?.caixa?.kmFaltante) {
          upd["caixa.kmFaltante"] = kmFaltCaixa; precisaUpdate = true;
        }

        if (precisaUpdate) {
          updates.push(updateDoc(doc(db, "parametros_manutencao", id), upd));
        }

        pushAviso(placaRaw, "motor", kmFaltMotor);
        pushAviso(placaRaw, "diferencial", kmFaltDif);
        pushAviso(placaRaw, "caixa", kmFaltCaixa);
      }

      if (updates.length) await Promise.all(updates);

      // atribuição direta + dedupe local
      const seen = new Set();
      const dedup = avisosLocal.filter(a => {
        const k = `${normPlaca(a.placa)}|${a.tipoOleo}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setAvisos(dedup);

      // injeta no seletor "Vincular a problema"
      if (avisosParaModal.length) {
        setProblemasAbertos(prev => {
          const prevKeys = new Set(prev.map(p => `${p.checklistId}:${p.nomeItem}:${p.veiculo || ""}`));
          const novos = avisosParaModal.filter(p => !prevKeys.has(`${p.checklistId}:${p.nomeItem}:${p.veiculo || ""}`));
          return [...prev, ...novos];
        });
      }
    } catch (err) {
      console.error("Erro ao calcular avisos:", err);
    }
  }, []);

  /* ============ Avisos por TEMPO (empilhadeiras) — recebe dados por parâmetro ============ */
  const computeAvisosEmpilhadeiras = useCallback(async (empilhadeirasList, manutencoesList) => {
    try {
      const hoje = new Date();
      const todosAvisos = [];

      // Quais já têm manutenção vinculada (pela info armazenada)
      const ativos = new Set(
        (manutencoesList || [])
          .filter(m => m.problemaVinculadoInfo?.checklistId === "emp-prev")
          .map(m => `${m.problemaVinculadoInfo.empId}|${m.problemaVinculadoInfo.manutKey}`)
      );

      for (const e of (empilhadeirasList || [])) {
        const tipo = (e.tipoEmpilhadeira || "").toLowerCase(); // "gas" | "eletrica"
        const nome = e.nome || "(sem nome)";

        // Data base por tipo/chave (se não houver, usa 15/04/2025)
        const baseGasRevisao = e.baseRevisaoGeralGas?.toDate?.() ? e.baseRevisaoGeralGas.toDate() : (e.baseRevisaoGeralGas ? new Date(e.baseRevisaoGeralGas) : DEFAULT_BASE);
        const baseGasOleo = e.baseTrocaOleoGas?.toDate?.() ? e.baseTrocaOleoGas.toDate() : (e.baseTrocaOleoGas ? new Date(e.baseTrocaOleoGas) : DEFAULT_BASE);
        const baseElecRevisao = e.baseRevisaoGeralEletrica?.toDate?.() ? e.baseRevisaoGeralEletrica.toDate() : (e.baseRevisaoGeralEletrica ? new Date(e.baseRevisaoGeralEletrica) : DEFAULT_BASE);

        const checks = [];
        if (tipo === "gas") {
          // ⚠️ Cálculo correto: próxima = base + intervalo (NÃO pula pro futuro)
          checks.push({ manutKey: "gas_revisao", label: "Revisão Geral (Gás)", proxima: addMonths(baseGasRevisao, 4) });
          checks.push({ manutKey: "gas_oleo", label: "Troca de Óleo do Motor (Gás)", proxima: addMonths(baseGasOleo, 8) });
        }
        if (tipo === "eletrica") {
          checks.push({ manutKey: "eletrica_revisao", label: "Revisão Geral (Elétrica)", proxima: addMonths(baseElecRevisao, 6) });
        }

        for (const c of checks) {
          const faltamDias = diffDays(c.proxima, hoje); // negativo = vencido
          const chave = `${e.id}|${c.manutKey}`;
          const isAlert = faltamDias <= 15;

          // sempre calculamos; mostramos apenas alertas/vencidos no painel
          todosAvisos.push({
            empId: e.id,
            nomeEmp: nome,
            tipoEmp: tipo,
            manutKey: c.manutKey,
            label: c.label,
            proxima: c.proxima,
            faltamDias,
            vencido: faltamDias < 0,
            isAlert,
            suprimido: isAlert && ativos.has(chave) // se já vinculado, não criar problema
          });
        }
      }

      // Guardamos todos, mas o painel exibe somente alertas/vencidos
      setAvisosEmp(todosAvisos.sort((a, b) => a.proxima - b.proxima));

      // Alimenta "Vincular a problema" somente com alertas ainda não suprimidos
      const alertasParaProblema = todosAvisos.filter(a => a.isAlert && !a.suprimido);
      if (alertasParaProblema.length) {
        const novosProblemas = alertasParaProblema.map(av => ({
          checklistId: "emp-prev",
          nomeItem: av.label,
          desc: `Próxima: ${av.proxima.toLocaleDateString("pt-BR")}`,
          veiculo: av.nomeEmp,
          empId: av.empId,
          manutKey: av.manutKey,
          tipoEmp: av.tipoEmp,
          dataHora: new Date(),
        }));

        setProblemasAbertos(prev => {
          const prevKeys = new Set(prev.map(p => `${p.checklistId}:${p.nomeItem}:${p.veiculo || ""}`));
          const novos = novosProblemas.filter(p => !prevKeys.has(`${p.checklistId}:${p.nomeItem}:${p.veiculo || ""}`));
          return [...prev, ...novos];
        });
      }
    } catch (err) {
      console.error("Erro ao calcular avisos de empilhadeiras:", err);
    }
  }, []);

  // 🔒 Travar scroll e evitar relayout enquanto o modal está aberto (opcional)
  useLayoutEffect(() => {
    if (showModal) {
      const { overflow, paddingRight } = document.body.style;
      const scrollbarComp = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = "hidden";
      if (scrollbarComp > 0) {
        document.body.style.paddingRight = `${scrollbarComp}px`;
      }
      return () => {
        document.body.style.overflow = overflow || "";
        document.body.style.paddingRight = paddingRight || "";
      };
    }
  }, [showModal]);

  /* ========= FIX do skeleton: função estável + trava de reentrada ========= */
  const loadingRef = useRef(false);
  const recarregarDados = useCallback(async () => {
    if (loadingRef.current) return;            // evita reentrância/loop
    loadingRef.current = true;
    setCarregando(true);
    try {
      const base = await fetchBase();          // pega os dados já carregados
      await computeAvisos();
      await computeAvisosEmpilhadeiras(base.empilhadeirasList, base.manutencoesList);
    } finally {
      setCarregando(false);
      loadingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 👈 dependências vazias intencionais

  // roda somente na montagem
  useEffect(() => {
    recarregarDados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualiza lista do modal baseado no tipo de equipamento
  useEffect(() => {
    if (showModal && equipamentoTipo) {
      let lista = [];
      if (equipamentoTipo === "veiculo") lista = veiculos;
      else if (equipamentoTipo === "empilhadeira") lista = empilhadeiras;
      else if (equipamentoTipo === "paleteira") lista = paleteiras;
      else if (equipamentoTipo === "gerador") lista = geradores;
      setListaEquipamentos(lista);
      setVeiculoNome("");
      setSelectedVeiculoId("");
    } else {
      setListaEquipamentos([]);
      setVeiculoNome("");
      setSelectedVeiculoId("");
    }
  }, [showModal, equipamentoTipo, veiculos, empilhadeiras, paleteiras, geradores]);

  /* ============ Filtragem e abas ============ */
  const manutencoesFiltradas = manutencoes.filter(m => {
    const veiculoOK = veiculoFiltro ? m.veiculoNome === veiculoFiltro : true;
    const dataOK = filtraPorData(m, dataInicio, dataFim);
    return veiculoOK && dataOK;
  });

  const hoje = new Date();
  const pendentes = manutencoesFiltradas.filter(m =>
    m.status === "pendente" ||
    (m.status === "aberta" && m.dataPrevista && new Date(m.dataPrevista) > hoje)
  );
  const abertas = manutencoesFiltradas.filter(m => m.status === "aberta" && (!m.dataPrevista || new Date(m.dataPrevista) <= hoje));
  const concluidas = manutencoesFiltradas.filter(m => m.status === "concluida");

  /* ============ Ações ============ */
  const resetarParametroOleo = async (placaStr, tipoOleoKey) => {
    try {
      if (!placaStr || !tipoOleoKey) return;
      const snap = await getDocs(query(
        collection(db, "parametros_manutencao"),
        where("placa", "==", placaStr)
      ));
      if (snap.empty) return;
      const ref = doc(db, "parametros_manutencao", snap.docs[0].id);
      const dados = snap.docs[0].data();
      const kmAtual = parseKm(dados.kmAtual);
      const intervalo = INTERVALO[tipoOleoKey] || 0;

      const upd = {};
      // Reinicia contador para o novo ciclo
      upd[`${tipoOleoKey}.kmFaltante`] = intervalo;
      if (kmAtual > 0) {
        upd[`${tipoOleoKey}.kmProximaTroca`] = kmAtual + intervalo;
      }
      await updateDoc(ref, upd);
    } catch (e) {
      console.error("Erro ao resetar parâmetro de óleo:", e);
    }
  };

  // 🔧 reseta a BASE da manutenção por tempo da empilhadeira ao vincular
  const resetarAgendamentoEmp = async (empId, manutKey) => {
    try {
      if (!empId || !manutKey) return;
      const ref = doc(db, "empilhadeiras", empId);
      const hoje = new Date();
      let fieldPath = null;
      if (manutKey === "gas_revisao") fieldPath = "baseRevisaoGeralGas";
      else if (manutKey === "gas_oleo") fieldPath = "baseTrocaOleoGas";
      else if (manutKey === "eletrica_revisao") fieldPath = "baseRevisaoGeralEletrica";
      if (!fieldPath) return;
      await updateDoc(ref, { [fieldPath]: hoje });
    } catch (e) {
      console.error("Erro ao resetar agendamento da empilhadeira:", e);
    }
  };

  const concluirManutencao = async (id) => {
    const manut = manutencoes.find(m => m.id === id);

    if (window.confirm("Marcar esta manutenção como concluída?")) {
      await updateDoc(doc(db, "manutencoes", id), { status: "concluida", dataConclusao: new Date() });

      // 🔁 Se for veículo, volta para ATIVO
      if (manut?.equipamentoTipo === "veiculo" && manut?.veiculoId) {
        try {
          await marcarAtivo(manut.veiculoId);
        } catch (e) {
          console.error("Falha ao marcar veículo como ativo:", e);
        }
      }

      // Resets automáticos conforme a origem
      const info = manut?.problemaVinculadoInfo;
      if (info?.checklistId === "manut-prev" && info?.tipoOleo && info?.veiculo) {
        await resetarParametroOleo(info.veiculo, info.tipoOleo);
      }
      if (info?.checklistId === "emp-prev" && info?.empId && info?.manutKey) {
        await resetarAgendamentoEmp(info.empId, info.manutKey);
      }

      await recarregarDados();
    }
  };

  const handleAdicionarManutencao = async (e) => {
    e.preventDefault();
    setEnviando(true);

    try {
      const dataPrevistaDate = dataPrevista ? new Date(dataPrevista + "T23:59:59") : null;
      const status = dataPrevistaDate && dataPrevistaDate > new Date() ? "pendente" : "aberta";

      const base = {
        tipo,
        equipamentoTipo,
        veiculoNome, // rótulo mostrado na lista (para veículo será "FROTA — PLACA")
        descricao,
        status,
        dataHora: new Date(),
        dataPrevista: dataPrevistaDate,
        criadoPor: user?.nome || "",
        problemaVinculado: null,
        problemaVinculadoInfo: null,
      };

      // Vincular a problema (checklist aberto / aviso de óleo / aviso empilhadeira tempo)
      let infoSelecionada = null;
      if (problemaVinculado) {
        infoSelecionada = problemasAbertos.find(
          p => `${p.checklistId}:${p.nomeItem}` === problemaVinculado
        );
        if (infoSelecionada) {
          base.problemaVinculado = `${infoSelecionada.veiculo} - ${infoSelecionada.nomeItem}: ${infoSelecionada.desc}`;
          base.problemaVinculadoInfo = {
            checklistId: infoSelecionada.checklistId,
            nomeItem: infoSelecionada.nomeItem,
            desc: infoSelecionada.desc,
            ...(infoSelecionada.tipoOleo ? { tipoOleo: infoSelecionada.tipoOleo } : {}),
            ...(infoSelecionada.veiculo ? { veiculo: infoSelecionada.veiculo } : {}),
            ...(infoSelecionada.empId ? { empId: infoSelecionada.empId } : {}),
            ...(infoSelecionada.manutKey ? { manutKey: infoSelecionada.manutKey } : {}),
            ...(infoSelecionada.tipoEmp ? { tipoEmp: infoSelecionada.tipoEmp } : {}),
          };
        }
      }

      // 🔧 Ajustes só quando é VEÍCULO
      let veiculoIdUsado = null;
      if (equipamentoTipo === "veiculo") {
        const v = await getVeiculoById(selectedVeiculoId);
        if (!v) throw new Error("Veículo não encontrado.");

        const label = labelVeiculo(v);
        base.veiculoId = v.id;
        base.veiculoNome = label; // snapshot "FROTA — PLACA"
        base.frotaNumeroSnapshot = v.frotaNumero || "";
        base.placaSnapshot = v.placa || "";

        veiculoIdUsado = v.id;
      }

      await addDoc(collection(db, "manutencoes"), base);

      // 🚧 Assim que cria manutenção de VEÍCULO -> marcar em manutenção
      if (veiculoIdUsado) {
        try {
          await marcarEmManutencao(veiculoIdUsado);
        } catch (e) {
          console.error("Falha ao marcar veículo em manutenção:", e);
        }
      }

      // 🔁 Resets AUTOMÁTICOS ao VINCULAR (criação)
      if (infoSelecionada?.checklistId === "emp-prev" && infoSelecionada.empId && infoSelecionada.manutKey) {
        await resetarAgendamentoEmp(infoSelecionada.empId, infoSelecionada.manutKey);
      }
      if (infoSelecionada?.checklistId === "manut-prev" && infoSelecionada.tipoOleo && infoSelecionada.veiculo) {
        await resetarParametroOleo(infoSelecionada.veiculo, infoSelecionada.tipoOleo);
      }


      // 🧹 Remove o problema vinculado da lista local imediatamente
      if (infoSelecionada) {
        setProblemasAbertos(prev =>
          prev.filter(p => `${p.checklistId}:${p.nomeItem}` !== `${infoSelecionada.checklistId}:${infoSelecionada.nomeItem}`)
        );
      }

      // 🗂️ Se o problema vier de um checklist, marca como vinculado no documento do checklist
      if (infoSelecionada && infoSelecionada.checklistId !== "manut-prev" && infoSelecionada.checklistId !== "emp-prev") {
        try {
          await updateDoc(
            doc(db, "checklists", infoSelecionada.checklistId),
            { [`problemasVinculados.${sanitizeFieldPath(infoSelecionada.nomeItem)}`]: true }
          );
        } catch (e) {
          console.error("Falha ao marcar problema como vinculado no checklist:", e);
        }
      }
      setShowModal(false);
      setTipo("");
      setEquipamentoTipo("");
      setListaEquipamentos([]);
      setVeiculoNome("");
      setSelectedVeiculoId("");
      setDescricao("");
      setDataPrevista("");
      setProblemaVinculado("");

      await recarregarDados();
    } catch (err) {
      alert("Erro ao cadastrar manutenção: " + err.message);
    }
    setEnviando(false);
  };

  // ===== UI helpers
  const contentShouldPulse = Boolean(carregando && !showModal);

  const listaOptions = useMemo(() => {
    if (!equipamentoTipo) return [];
    if (equipamentoTipo === "veiculo")
      return veiculos.map(v => ({ value: v.id, label: v.displayLabel, isVehicle: true }));
    if (equipamentoTipo === "empilhadeira")
      return empilhadeiras.map(v => ({ value: v.nome, label: v.nome }));
    if (equipamentoTipo === "paleteira")
      return paleteiras.map(v => ({ value: v.nome, label: v.nome }));
    if (equipamentoTipo === "gerador")
      return geradores.map(v => ({ value: v.nome, label: v.nome }));
    return [];
  }, [equipamentoTipo, veiculos, empilhadeiras, paleteiras, geradores]);

  // Contador de alertas (≤ 15 dias) para o badge
  const totalAlertasEmp = avisosEmp.filter(a => a.faltamDias <= 15 && !a.suprimido).length;

  return (
    <div className="min-vh-100 bg-dark text-light py-4 px-2 d-flex flex-column align-items-center">
      <div className="w-100" style={{ maxWidth: 1100 }}>
        {/* Voltar */}
        <button
          type="button"
          className="btn-voltar"
          onClick={() => navigate("/")}
        >
          ← Voltar
        </button>
        <h2 className="fw-bold mb-4 text-center text-white">Painel de Manutenções</h2>

        {/* Painel de AVISOS - ÓLEO (KM) */}
        <div className="mb-4">
          <div className="card border-0 shadow" style={{ background: "#1f2430", color: "#e6eef5" }}>
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between">
                <h5 className="card-title m-0 fw-bold">
                  Avisos de Troca de Óleo (≤ 500 km)
                </h5>
                <span className={`badge ${avisos.length ? "bg-danger" : "bg-secondary"}`}>
                  {avisos.length}
                </span>
              </div>

              <div className="mt-3">
                {contentShouldPulse ? (
                  <div>
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="placeholder-glow mb-2">
                        <span className="placeholder col-7"></span>
                        <span className="placeholder col-4 ms-2"></span>
                      </div>
                    ))}
                  </div>
                ) : avisos.length === 0 ? (
                  <div className="text-secondary">Nenhum aviso no momento.</div>
                ) : (
                  <ul className="mb-0">
                    {avisos.map((a, i) => {
                      const oilBadge =
                        a.tipoOleo === "motor" ? "bg-danger" :
                        a.tipoOleo === "diferencial" ? "bg-info text-dark" :
                        "bg-warning text-dark";

                      const sever =
                        a.kmFaltante <= 100 ? "text-danger fw-bold" : "text-warning";

                      return (
                        <li key={a.placa + "_" + a.tipoOleo + "_" + i} className="mb-1">
                          <span className={`badge ${oilBadge} me-2`}>
                            {a.tipoOleo === "motor"
                              ? "Óleo do Motor"
                              : a.tipoOleo === "diferencial"
                              ? "Óleo do Diferencial"
                              : "Óleo da Caixa"}
                          </span>
                          <b>{a.placa}</b>{" "}
                          <span className={sever}>
                            — faltam {a.kmFaltante} km
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="small mt-2" style={{ opacity: .85 }}>
                * Para remover da lista, conclua ou vincule a manutenção para a placa.
              </div>
            </div>
          </div>
        </div>

        {/* Painel de AVISOS - EMPILHADEIRAS (TEMPO + DATA PREVISTA) */}
        <div className="mb-4">
          <div className="card border-0 shadow" style={{ background: "#1f2430", color: "#e6eef5" }}>
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between">
                <h5 className="card-title m-0 fw-bold">
                  Avisos de Manutenção — Empilhadeiras (≤ 15 dias)
                </h5>
                <span className={`badge ${totalAlertasEmp ? "bg-warning text-dark" : "bg-secondary"}`}>
                  {totalAlertasEmp}
                </span>
              </div>

              <div className="mt-3">
                {contentShouldPulse ? (
                  <div>
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="placeholder-glow mb-2">
                        <span className="placeholder col-6"></span>
                        <span className="placeholder col-3 ms-2"></span>
                      </div>
                    ))}
                  </div>
                ) : (
                  (() => {
                    const itens = avisosEmp.filter(a => a.faltamDias <= 15 && !a.suprimido);
                    return itens.length === 0 ? (
                      <div className="text-secondary">Nenhum aviso por tempo no momento.</div>
                    ) : (
                      <ul className="mb-0">
                        {itens.map((av, i) => {
                          const tipoBadge = av.tipoEmp === "gas" ? "bg-primary" : "bg-success";
                          const textoClasse =
                            av.faltamDias <= 15 ? "text-danger fw-bold" : "text-secondary";
                          const quando =
                            av.faltamDias < 0
                              ? `vencida há ${Math.abs(av.faltamDias)} ${Math.abs(av.faltamDias) === 1 ? "dia" : "dias"}`
                              : av.faltamDias === 0
                              ? "é hoje"
                              : `faltam ${av.faltamDias} ${av.faltamDias === 1 ? "dia" : "dias"}`;

                          return (
                            <li key={`${av.empId}_${av.manutKey}_${i}`} className="mb-1">
                              <span className={`badge ${tipoBadge} me-2`}>
                                {av.tipoEmp === "gas" ? "Gás" : "Elétrica"}
                              </span>
                              <b>{av.nomeEmp}</b>{" "}
                              <span className="badge bg-info text-dark ms-2">{av.label}</span>{" "}
                              — próxima em <b>{av.proxima.toLocaleDateString("pt-BR")}</b>{" "}
                              <span className={textoClasse}>
                                ({quando})
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()
                )}
              </div>

              <div className="small mt-2" style={{ opacity: .85 }}>
                * Ao incluir uma manutenção vinculando esse aviso, o contador é reiniciado para a data atual.
              </div>
            </div>
          </div>
        </div>

        {/* Botão novo */}
        <div className="text-center mb-4">
          <button
            className="btn btn-success px-4 fw-bold"
            onClick={() => setShowModal(true)}
          >
            + Incluir nova manutenção
          </button>
        </div>

        {/* Contadores */}
        <div className="d-flex gap-3 justify-content-center mb-4">
          <span className="badge bg-danger fs-6">Abertos: {manutencoesFiltradas.filter(m => m.status === "aberta" && (!m.dataPrevista || new Date(m.dataPrevista) <= hoje)).length}</span>
          <span className="badge bg-warning text-dark fs-6">Pendentes: {manutencoesFiltradas.filter(m => m.status === "pendente" || (m.status === "aberta" && m.dataPrevista && new Date(m.dataPrevista) > hoje)).length}</span>
          <span className="badge bg-success fs-6">Concluídos: {manutencoesFiltradas.filter(m => m.status === "concluida").length}</span>
        </div>

        {/* Filtros */}
        <div className="row g-2 mb-3 justify-content-center">
          <div className="col-md-3">
            <label className="form-label mb-1">Data Início</label>
            <input
              type="date"
              className="form-control"
              value={dataInicio}
              onChange={e => setDataInicio(e.target.value)}
            />
          </div>
          <div className="col-md-3">
            <label className="form-label mb-1">Data Fim</label>
            <input
              type="date"
              className="form-control"
              value={dataFim}
              onChange={e => setDataFim(e.target.value)}
            />
          </div>
          <div className="col-md-3">
            <label className="form-label mb-1">Veículo/Equipamento</label>
            <select
              className="form-select"
              value={veiculoFiltro}
              onChange={e => setVeiculoFiltro(e.target.value)}
            >
              <option value="">Todos</option>
              {[
                ...veiculos.map(v => ({ value: v.displayLabel, label: v.displayLabel })),
                ...empilhadeiras.map(v => ({ value: v.nome, label: v.nome })),
                ...paleteiras.map(v => ({ value: v.nome, label: v.nome })),
                ...geradores.map(v => ({ value: v.nome, label: v.nome })),
              ].map((opt, idx) => (
                <option key={opt.value + "_" + idx} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Abas */}
        <ul className="nav nav-tabs mb-3 justify-content-center">
          <li className="nav-item">
            <button
              className={`nav-link fw-bold ${aba === "abertas" ? "active" : ""}`}
              onClick={() => setAba("abertas")}
            >
              Em aberto
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link fw-bold ${aba === "pendentes" ? "active" : ""}`}
              onClick={() => setAba("pendentes")}
            >
              Pendentes
            </button>
          </li>
          <li className="nav-item">
            <button
              className={`nav-link fw-bold ${aba === "concluidas" ? "active" : ""}`}
              onClick={() => setAba("concluidas")}
            >
              Concluídas
            </button>
          </li>
        </ul>

        {/* Listas */}
        <div className="card bg-light text-dark shadow border-0 mb-5">
          <div className="card-body">
            {contentShouldPulse ? (
              <div>
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="placeholder-glow mb-3">
                    <div className="placeholder col-9 mb-2"></div>
                    <div className="placeholder col-6"></div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* ABERTAS */}
                {aba === "abertas" && (
                  <>
                    <h5 className="mb-3 fw-bold text-danger">Manutenções em aberto</h5>
                    {abertas.length === 0 ? (
                      <div className="text-secondary text-center">Nenhuma manutenção em aberto.</div>
                    ) : (
                      abertas.map(m => (
                        <div key={m.id} className="mb-3 p-3 bg-white rounded shadow-sm d-flex justify-content-between align-items-center">
                          <div>
                            <b>{m.tipo?.toUpperCase()}</b> - <span className="fw-bold">{m.veiculoNome}</span>{" "}
                            <span className="badge bg-secondary ms-2">{m.equipamentoTipo || "veículo"} </span>
                            <div className="small text-secondary">
                              {m.problemaVinculado ? `Origem: ${m.problemaVinculado}` : ""}
                            </div>
                            <div className="small text-secondary">{formatDate(m.dataHora)}</div>
                            <div className="text-dark">{m.descricao}</div>
                          </div>
                          <button className="btn btn-success btn-sm fw-bold" onClick={() => concluirManutencao(m.id)}>
                            Marcar como concluída
                          </button>
                        </div>
                      ))
                    )}
                  </>
                )}

                {/* PENDENTES */}
                {aba === "pendentes" && (
                  <>
                    <h5 className="mb-3 fw-bold text-warning">Manutenções Pendentes (agendadas)</h5>
                    {pendentes.length === 0 ? (
                      <div className="text-secondary text-center">Nenhuma manutenção pendente/agendada.</div>
                    ) : (
                      pendentes.map(m => (
                        <div key={m.id} className="mb-3 p-3 bg-white rounded shadow-sm d-flex justify-content-between align-items-center">
                          <div>
                            <b>{m.tipo?.toUpperCase()}</b> - <span className="fw-bold">{m.veiculoNome}</span>{" "}
                            <span className="badge bg-secondary ms-2">{m.equipamentoTipo || "veículo"}</span>
                            <div className="small text-secondary">
                              {m.problemaVinculado ? `Origem: ${m.problemaVinculado}` : ""}
                            </div>
                            <div className="small text-secondary">{formatDate(m.dataPrevista)}</div>
                            <div className="text-dark">{m.descricao}</div>
                          </div>
                          <button className="btn btn-success btn-sm fw-bold" onClick={() => concluirManutencao(m.id)}>
                            Marcar como concluída
                          </button>
                        </div>
                      ))
                    )}
                  </>
                )}

                {/* CONCLUÍDAS */}
                {aba === "concluidas" && (
                  <>
                    <h5 className="mb-3 fw-bold text-success">Manutenções concluídas</h5>
                    {concluidas.length === 0 ? (
                      <div className="text-secondary text-center">Nenhuma manutenção concluída.</div>
                    ) : (
                      concluidas.map(m => (
                        <div key={m.id} className="mb-3 p-3 bg-white rounded shadow-sm">
                          <b>{m.tipo?.toUpperCase()}</b> - <span className="fw-bold">{m.veiculoNome}</span>{" "}
                          <span className="badge bg-secondary ms-2">{m.equipamentoTipo || "veículo"}</span>
                          <div className="small text-secondary">
                            {m.problemaVinculado ? `Origem: ${m.problemaVinculado}` : ""}
                          </div>
                          <div className="small text-secondary">
                            Criada: {formatDate(m.dataHora)} {m.dataConclusao ? `— Concluída: ${formatDate(m.dataConclusao)}` : ""}
                          </div>
                          <div className="text-dark">{m.descricao}</div>
                        </div>
                      ))
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Modal via Portal (custom, sem classes JS do Bootstrap) */}
      {showModal && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.55)",
            zIndex: 1050,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "cmFadeIn 120ms ease-out"
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              background: "#fff",
              borderRadius: 16,
              boxShadow: "0 10px 30px rgba(0,0,0,.25)",
              overflow: "hidden",
              transform: "translateY(0)",
              animation: "cmSlideUp 140ms ease-out"
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleAdicionarManutencao}>
  {/* Cabeçalho */}
  <div className="modal-header border-0 pb-0 px-4 pt-4">
    <h5 className="modal-title fw-bold text-primary">Nova Manutenção</h5>
    <button
      type="button"
      className="btn-close"
      onClick={() => setShowModal(false)}
    />
  </div>

  {/* Corpo */}
  <div className="modal-body px-4 text-dark">
    <div className="mb-3">
      <label className="form-label">Tipo</label>
      <select
        className="form-select"
        required
        value={tipo}
        onChange={(e) => setTipo(e.target.value)}
      >
        <option value="">Selecione...</option>
        <option value="preventiva">Preventiva</option>
        <option value="corretiva">Corretiva</option>
        <option value="preditiva">Preditiva</option>
      </select>
    </div>

    <div className="mb-3">
      <label className="form-label">Equipamento</label>
      <select
        className="form-select"
        required
        value={equipamentoTipo}
        onChange={(e) => setEquipamentoTipo(e.target.value)}
      >
        <option value="">Selecione...</option>
        <option value="veiculo">Veículo</option>
        <option value="empilhadeira">Empilhadeira</option>
        <option value="paleteira">Paleteira</option>
        <option value="gerador">Gerador</option>
      </select>
    </div>

    <div className="mb-3">
      <label className="form-label">Selecionar</label>
      <select
        className="form-select"
        required
        value={equipamentoTipo === "veiculo" ? selectedVeiculoId : veiculoNome}
        onChange={(e) => {
          if (equipamentoTipo === "veiculo") {
            const id = e.target.value;
            setSelectedVeiculoId(id);
            const v = listaEquipamentos.find((x) => x.id === id);
            setVeiculoNome(v ? v.displayLabel : "");
          } else {
            setVeiculoNome(e.target.value);
          }
        }}
      >
        <option value="">
          {`Selecione o ${equipamentoTipo || "equipamento"}`}
        </option>

        {listaOptions.map((opt, idx) =>
          equipamentoTipo === "veiculo" ? (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ) : (
            <option key={opt.value + "_" + idx} value={opt.value}>
              {opt.label}
            </option>
          )
        )}
      </select>
    </div>

    <div className="mb-3">
      <label className="form-label">Descrição</label>
      <textarea
        className="form-control"
        required
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
        rows={3}
      />
    </div>

    <div className="mb-3">
      <label className="form-label">Data prevista (opcional)</label>
      <input
        type="date"
        className="form-control"
        value={dataPrevista}
        onChange={(e) => setDataPrevista(e.target.value)}
      />
    </div>

    <div className="mb-3">
      <label className="form-label">Vincular a problema (opcional)</label>
      <select
        className="form-select"
        value={problemaVinculado}
        onChange={(e) => setProblemaVinculado(e.target.value)}
      >
        <option value="">Nenhum</option>
        {problemasAbertos.map((p, idx) => (
          <option key={idx} value={`${p.checklistId}:${p.nomeItem}`}>
            {p.tipoOleo
              ? p.tipoOleo === "motor"
                ? "Óleo do Motor"
                : p.tipoOleo === "diferencial"
                ? "Óleo do Diferencial"
                : "Óleo da Caixa"
              : p.nomeItem}{" "}
            — {p.veiculo}: {p.desc}
          </option>
        ))}
      </select>
      {problemasAbertos.length === 0 && (
        <div className="small text-secondary mt-1">
          Nenhum problema em aberto encontrado.
        </div>
      )}
    </div>
  </div>

  {/* Rodapé */}
  <div className="modal-footer border-0 px-4 pb-4 text-dark">
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => setShowModal(false)}
    >
      Cancelar
    </button>
    <button
      type="submit"
      className="btn btn-primary fw-bold"
      disabled={enviando}
    >
      {enviando ? "Enviando..." : "Salvar"}
    </button>
  </div>
</form>

          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
