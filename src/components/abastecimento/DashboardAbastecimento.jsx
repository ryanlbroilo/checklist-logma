// src/components/abastecimento/DashboardAbastecimento.jsx
import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaGasPump,
  FaGaugeHigh,
  FaMoneyBillWave,
  FaPlus,
  FaFileExcel,
  FaImage,
} from "react-icons/fa6";
import { FaSearch, FaEdit, FaTrash } from "react-icons/fa";
import { collection, query, where, orderBy, getDocs, Timestamp, doc, updateDoc } from "firebase/firestore";
import { db } from "../../services/firebase";

import {
  lerConfigAbastecimento,
  salvarThreshold,
  deleteAbastecimento,
} from "../../services/abastecimentos";
import { getVeiculosAtivos } from "../../services/veiculos";

const VeiculosSection = lazy(() => import("../VeiculosSection"));
import ModalLancarAbastecimento from "./ModalLancarAbastecimento";
import EditarAbastecimentoModal from "./EditarAbastecimentoModal";

function ymNow() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function DeltaBadge({ value }) {
  if (value == null || Number.isNaN(value)) return null;
  const num = Number(value);
  const sign = num > 0 ? "+" : "";
  const cls =
    num > 0
      ? "badge bg-danger-subtle text-danger-emphasis"
      : num < 0
      ? "badge bg-success-subtle text-success-emphasis"
      : "badge bg-secondary-subtle text-secondary-emphasis";
  return <span className={`ms-2 ${cls}`}>{sign}{num.toFixed(2)}</span>;
}

// helpers
function getMonthBounds(ano, mes) {
  const start = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
  const end = new Date(ano, mes, 1, 0, 0, 0, 0);
  return { startTs: Timestamp.fromDate(start), endTs: Timestamp.fromDate(end) };
}

function normalizeRow(raw) {
  const dateField = raw.dataAbastecimento || raw.dataHora || raw.criadoEm || raw.createdAt || null;
  const observacao = raw.observacao ?? raw.posto ?? raw.obs ?? "";
  const valorTotal =
    typeof raw.valorTotal === "number" && !isNaN(raw.valorTotal)
      ? raw.valorTotal
      : Number(((Number(raw.litros || 0) * Number(raw.precoPorLitro || 0)) || 0).toFixed(2));
  const tipoFrotaNorm = (raw.tipoFrota || "").toString().trim().toLowerCase();
  const tipoCombNorm = (raw.tipoCombustivel || "").toString().trim().toLowerCase();

  return {
    id: raw.id,
    veiculoId: raw.veiculoId || "",
    placa: (raw.placa || "").toUpperCase(),
    frotaNumero: raw.frotaNumero || "",
    tipoFrota: tipoFrotaNorm,
    tipoCombustivel: tipoCombNorm,
    isArla: tipoCombNorm === "arla",
    imagem: raw.imagem || raw.fotoUrl || null, // ⬅️ traz a URL (campo imagem/fotoUrl)
    litros: Number(raw.litros || 0),
    precoPorLitro: Number(raw.precoPorLitro || 0),
    valorTotal,
    kmAtual: raw.kmAtual != null ? Number(raw.kmAtual) : null,
    kmPorLitro: raw.kmPorLitro != null ? Number(raw.kmPorLitro) : null,
    observacao,
    dataAbastecimento: dateField, // Timestamp ou Date
  };
}

async function fetchAbastecimentosMes({ ano, mes, tipoFrota }) {
  const { startTs, endTs } = getMonthBounds(ano, mes);
  const col = collection(db, "abastecimentos");

  // 3 consultas por DATA (sem where de frota) para cobrir variados campos de data
  const queries = [
    query(
      col,
      where("dataAbastecimento", ">=", startTs),
      where("dataAbastecimento", "<", endTs),
      orderBy("dataAbastecimento", "desc")
    ),
    query(
      col,
      where("dataHora", ">=", startTs),
      where("dataHora", "<", endTs),
      orderBy("dataHora", "desc")
    ),
    query(
      col,
      where("createdAt", ">=", startTs),
      where("createdAt", "<", endTs),
      orderBy("createdAt", "desc")
    ),
  ];

  const results = [];
  for (const qRef of queries) {
    try {
      const snap = await getDocs(qRef);
      for (const docSnap of snap.docs) {
        results.push({ id: docSnap.id, ...docSnap.data() });
      }
    } catch (e) {
      console.warn("Consulta ignorada (provável índice ausente):", e?.message || e);
    }
  }

  // merge por id
  const byId = new Map();
  for (const r of results) byId.set(r.id, r);

  // normaliza
  let rows = Array.from(byId.values()).map(normalizeRow);

  // filtro de frota no client
  if (tipoFrota === "leve" || tipoFrota === "pesada") {
    rows = rows.filter((r) => (r.tipoFrota || "").toLowerCase() === tipoFrota);
  }

  // ordena por data (desc)
  rows.sort((a, b) => {
    const toMs = (x) =>
      typeof x?.toDate === "function"
        ? x.toDate().getTime()
        : x?.seconds
        ? x.seconds * 1000
        : x instanceof Date
        ? x.getTime()
        : 0;
    return toMs(b.dataAbastecimento) - toMs(a.dataAbastecimento);
  });

  return rows;
}

export default function DashboardAbastecimento() {
  const navigate = useNavigate();

  const [{ year, month }, setYM] = useState(ymNow());
  const [frota, setFrota] = useState("todas"); // "todas" | "leve" | "pesada"
  const [loading, setLoading] = useState(false);

  const [th, setTh] = useState({
    leve: { precoMedioTarget: 6.5 },
    pesada: { precoMedioTarget: 5.5 },
  });
  const [savingTarget, setSavingTarget] = useState(false);
  const [showTargetEditor, setShowTargetEditor] = useState(false);

  const [veiculos, setVeiculos] = useState([]);
  const [registros, setRegistros] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [filtroPlaca, setFiltroPlaca] = useState("");

  const [showVeiculos, setShowVeiculos] = useState(false);
  const [showLancar, setShowLancar] = useState(false);

  // edição em modal
  const [showEditar, setShowEditar] = useState(false);
  const [registroSelecionado, setRegistroSelecionado] = useState(null);

  // visualizar imagem
  const [showImagem, setShowImagem] = useState(false);
  const [imagemUrl, setImagemUrl] = useState(null);

  // thresholds
  useEffect(() => {
    (async () => {
      try {
        const cfg = await lerConfigAbastecimento();
        setTh({
          leve: { precoMedioTarget: Number(cfg?.alvoPrecoLeve ?? 6.5) },
          pesada: { precoMedioTarget: Number(cfg?.alvoPrecoPesada ?? 5.5) },
        });
      } catch {}
    })();
  }, []);

  // veículos
  useEffect(() => {
    (async () => {
      const listaAtivos = await getVeiculosAtivos();
      setVeiculos(listaAtivos);
    })();
  }, []);

  // carregamento principal (com 3 caminhos de data)
  const loadDados = async () => {
    setLoading(true);
    try {
      const tipoFrota = frota === "todas" ? undefined : frota;

      const atuais = await fetchAbastecimentosMes({ ano: year, mes: month, tipoFrota });

      // mês anterior
      let prevMes = month - 1;
      let prevAno = year;
      if (prevMes < 1) {
        prevMes = 12;
        prevAno = year - 1;
      }
      const anteriores = await fetchAbastecimentosMes({ ano: prevAno, mes: prevMes, tipoFrota });

      setRegistros(atuais);

      // KPIs (ignorando ARLA nos cálculos de preço/consumo)
      const calc = (items) => {
        const combustiveis = items.filter((i) => !i.isArla);

        // Total gasto pode considerar tudo
        const somaValorTotalTodos = items.reduce((acc, i) => acc + Number(i.valorTotal || 0), 0);

        const somaValor = combustiveis.reduce((acc, i) => acc + Number(i.valorTotal || 0), 0);
        const somaLitros = combustiveis.reduce((acc, i) => acc + Number(i.litros || 0), 0);
        const precoMedio = somaLitros > 0 ? somaValor / somaLitros : 0;

        const somaKm = combustiveis.reduce((acc, i) => {
          const kml = Number(i.kmPorLitro);
          const l = Number(i.litros);
          if (isFinite(kml) && kml > 0 && isFinite(l) && l > 0) return acc + kml * l;
          return acc;
        }, 0);
        const consumoMedioFrota = somaLitros > 0 ? somaKm / somaLitros : null;

        return {
          totalGasto: Number(somaValorTotalTodos.toFixed(2)),       // tudo
          litrosTotais: Number(somaLitros.toFixed(2)),              // só combustíveis
          precoMedio: Number(precoMedio.toFixed(4)),                // só combustíveis
          consumoMedioFrota: consumoMedioFrota != null ? Number(consumoMedioFrota.toFixed(3)) : null, // só combustíveis
        };
      };

      const atual = calc(atuais);
      const anterior = calc(anteriores);
      const delta = {
        totalGasto: Number((atual.totalGasto - anterior.totalGasto).toFixed(2)),
        precoMedio: Number((atual.precoMedio - anterior.precoMedio).toFixed(4)),
        consumoMedioFrota:
          atual.consumoMedioFrota != null && anterior.consumoMedioFrota != null
            ? Number((atual.consumoMedioFrota - anterior.consumoMedioFrota).toFixed(3))
            : null,
      };

      setKpis({
        atual,
        anterior,
        delta,
        refAnterior: { mes: prevMes, ano: prevAno },
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, frota]);

  const mapVeic = useMemo(() => {
    const m = new Map();
    for (const v of veiculos) m.set(v.id, v);
    return m;
  }, [veiculos]);

  const precoTargetAtual =
    frota === "leve" ? th.leve.precoMedioTarget : frota === "pesada" ? th.pesada.precoMedioTarget : null;

  // filtro por placa
  const listaAbastFiltrada = useMemo(() => {
    const frag = filtroPlaca.trim().toUpperCase();
    if (!frag) return registros;
    return registros.filter((a) => (a.placa || "").toUpperCase().includes(frag));
  }, [registros, filtroPlaca]);

  // R$/L ponderado (sem ARLA)
  const precoMedioFiltrado = useMemo(() => {
    const visiveis = (listaAbastFiltrada || []).filter((r) => !r.isArla);
    if (!visiveis.length) return null;

    const { totalLitros, totalValor } = visiveis.reduce(
      (acc, r) => {
        const litros = Number(r.litros) || 0;
        const preco = Number(r.precoPorLitro) || 0;
        acc.totalLitros += litros;
        acc.totalValor += litros * preco;
        return acc;
      },
      { totalLitros: 0, totalValor: 0 }
    );
    return totalLitros > 0 ? totalValor / totalLitros : null;
  }, [listaAbastFiltrada]);

  async function handleSalvarTarget() {
    if (frota === "todas") return;
    setSavingTarget(true);
    try {
      if (frota === "leve") await salvarThreshold({ alvoPrecoLeve: th.leve.precoMedioTarget });
      else await salvarThreshold({ alvoPrecoPesada: th.pesada.precoMedioTarget });
      setShowTargetEditor(false);
      await loadDados();
    } finally {
      setSavingTarget(false);
    }
  }

  // ações
  const handleDelete = async (id) => {
    try {
      const confirmar = window.confirm("Excluir este abastecimento? Esta ação não pode ser desfeita.");
      if (!confirmar) return;
      await deleteAbastecimento(id);
      await loadDados();
    } catch (err) {
      console.error("Erro ao excluir abastecimento", err);
      alert("Erro ao excluir abastecimento. Tente novamente.");
    }
  };

  const handleEditOpen = (item) => {
    setRegistroSelecionado(item);
    setShowEditar(true);
  };

  // KPIs
  const consumoAtual = kpis?.atual?.consumoMedioFrota ?? null;
  const consumoAnterior = kpis?.anterior?.consumoMedioFrota ?? null;
  const consumoDelta =
    consumoAtual != null && consumoAnterior != null
      ? Number((consumoAtual - consumoAnterior).toFixed(3))
      : null;

  const atualTotal = Number(kpis?.atual?.totalGasto ?? 0);
  const anteriorTotal = Number(kpis?.anterior?.totalGasto ?? 0);
  const gastoDelta = (atualTotal || anteriorTotal) ? (atualTotal - anteriorTotal) : null;

  /* ========= Exportar Excel (SheetJS) ========= */
  async function handleExportExcel(tipo = "filtro") {
    try {
      const XLSX = await import("xlsx");
      const mm = String(month).padStart(2, "0");
      const titulo = `Abastecimentos ${year}-${mm} ${frota}`;

      const rows = (tipo === "filtro" ? listaAbastFiltrada : registros).map((a) => {
        const v = mapVeic.get(a.veiculoId);
        const dtObj =
          typeof a.dataAbastecimento?.toDate === "function"
            ? a.dataAbastecimento.toDate()
            : a.dataAbastecimento?.seconds
            ? new Date(a.dataAbastecimento.seconds * 1000)
            : a.dataAbastecimento instanceof Date
            ? a.dataAbastecimento
            : null;
        return {
          Data: dtObj ? dtObj.toLocaleDateString("pt-BR") : "",
          Frota: a.tipoFrota || "",
          "Frota Nº": v?.frotaNumero || a.frotaNumero || "",
          Placa: (v?.placa || a.placa || "").toUpperCase(),
          Veículo: v?.nome || "",
          Litros: typeof a.litros === "number" ? a.litros : "",
          "Preço/L": typeof a.precoPorLitro === "number" ? a.precoPorLitro : "",
          "Valor Total": typeof a.valorTotal === "number" ? a.valorTotal : "",
          "KM Atual": a.kmAtual ?? "",
          "KM/L": a.kmPorLitro ?? "",
          Combustível: a.tipoCombustivel || "",
          "Posto/Obs.": a.observacao || "",
        };
      });
      const ws1 = XLSX.utils.json_to_sheet(rows);

      const ws2 = XLSX.utils.aoa_to_sheet([
        ["KPIs", titulo],
        [],
        ["Mês", "Total Gasto (R$)", "Litros Totais", "Preço Médio (R$/L)", "Média km/L"],
        ["Atual", kpis?.atual?.totalGasto ?? "", kpis?.atual?.litrosTotais ?? "", kpis?.atual?.precoMedio ?? "", kpis?.atual?.consumoMedioFrota ?? ""],
        ["Anterior", kpis?.anterior?.totalGasto ?? "", kpis?.anterior?.litrosTotais ?? "", kpis?.anterior?.precoMedio ?? "", kpis?.anterior?.consumoMedioFrota ?? ""],
      ]);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, "Abastecimentos");
      XLSX.utils.book_append_sheet(wb, ws2, "KPIs");

      const filename = `abastecimentos_${year}-${mm}_${frota}.xlsx`;
      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error(err);
      alert("Para exportar, instale a dependência: npm i xlsx");
    }
  }

  return (
    <div className="container py-3">
      {/* Header */}
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div className="d-flex align-items-center gap-2">
          <button type="button" className="btn-voltar" onClick={() => navigate(-1)}>
            Voltar
          </button>
          <h4 className="m-0 fw-bold text-primary">Dashboard de Abastecimento</h4>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button type="button" className="btn btn-success d-flex align-items-center gap-2" onClick={() => handleExportExcel("filtro")}>
            <FaFileExcel /> Exportar Excel
          </button>
          <button type="button" className="btn btn-primary d-flex align-items-center gap-2" onClick={() => setShowLancar(true)}>
            <FaPlus /> Lançar abastecimento
          </button>
          <button type="button" className="btn btn-outline-primary d-flex align-items-center gap-2" onClick={() => setShowVeiculos(true)}>
            <FaPlus /> Adicionar Veículo
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <select className="form-select w-auto" value={frota} onChange={(e) => setFrota(e.target.value)}>
            <option value="todas">Todas as Frotas</option>
            <option value="leve">Frota Leve</option>
            <option value="pesada">Frota Pesada</option>
          </select>

          <input
            type="month"
            className="form-control w-auto"
            value={`${year}-${String(month).padStart(2, "0")}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              setYM({ year: y, month: m });
            }}
          />
        </div>

        {/* Editor de alvo */}
        {frota !== "todas" && (
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setShowTargetEditor((s) => !s)}
              aria-expanded={showTargetEditor}
            >
              {showTargetEditor ? "Fechar edição do alvo" : "Editar alvo R$/L"}
            </button>
          </div>
        )}
      </div>

      {frota !== "todas" && showTargetEditor && (
        <div className="card border-0 shadow-sm mb-3">
          <div className="card-body d-flex flex-wrap align-items-center gap-2">
            <label className="form-label mb-0">Alvo R$/L para frota {frota}:</label>
            <input
              type="number"
              step="0.001"
              className="form-control w-auto"
              value={frota === "leve" ? th.leve.precoMedioTarget : th.pesada.precoMedioTarget}
              onChange={(e) => {
                const val = Number(e.target.value);
                setTh((prev) => ({ ...prev, [frota]: { ...prev[frota], precoMedioTarget: val } }));
              }}
            />
            <button type="button" className="btn btn-primary" onClick={handleSalvarTarget} disabled={savingTarget}>
              {savingTarget ? "Salvando..." : "Salvar alvo"}
            </button>
          </div>
        </div>
      )}

      {/* Busca por placa */}
      <div className="d-flex align-items-center gap-2 mb-3">
        <div className="input-group" style={{ maxWidth: 380 }}>
          <span className="input-group-text">
            <FaSearch />
          </span>
          <input
            className="form-control"
            placeholder="Filtrar por placa (ex.: IZP)"
            value={filtroPlaca}
            onChange={(e) => setFiltroPlaca(e.target.value)}
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="row g-3">
        {/* Média km/L */}
        <div className="col-12 col-md-4">
          <div className="card border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-1">
                <span className="text-muted small">Média km/L ({String(month).padStart(2, "0")}/{year})</span>
                <FaGaugeHigh className="text-secondary" />
              </div>
              <div className={`h2 m-0 ${consumoDelta == null ? "" : consumoDelta > 0 ? "text-success" : "text-danger"}`}>
                {loading ? "…" : (consumoAtual ?? "—")}
                {!loading && consumoDelta != null && <DeltaBadge value={consumoDelta} />}
              </div>
              {!loading && consumoAnterior != null && (
                <div className="small text-muted mt-1">
                  Mês anterior ({String(kpis?.refAnterior?.mes).padStart(2, "0")}/{kpis?.refAnterior?.ano}): {consumoAnterior} km/L
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Preço médio vs alvo */}
        <div className="col-12 col-md-4">
          <div className="card border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-1">
                <span className="text-muted small">Preço médio (R$/L){frota !== "todas" ? ` — Frota ${frota}` : ""}</span>
                <FaGasPump className="text-secondary" />
              </div>
              <div
                className={`h2 m-0 ${
                  frota !== "todas" && precoTargetAtual != null
                    ? (Number(precoMedioFiltrado ?? 0) < Number(precoTargetAtual) ? "text-success" : "text-danger")
                    : ""
                }`}
              >
                {loading ? "…" : (precoMedioFiltrado != null ? precoMedioFiltrado.toFixed(3) : "—")}
              </div>
              {frota !== "todas" ? (
                <div className="small text-muted mt-1">Alvo atual: R$ {Number(precoTargetAtual ?? 0).toFixed(3)}</div>
              ) : (
                <div className="small text-muted mt-1">Mostrando média geral (Leve + Pesada). Selecione uma frota para comparar com o alvo.</div>
              )}
            </div>
          </div>
        </div>

        {/* Gasto total */}
        <div className="col-12 col-md-4">
          <div className="card border-0 shadow-sm">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-1">
                <span className="text-muted small">Gasto total {frota === "todas" ? "(Leve + Pesada)" : `(Frota ${frota})`}</span>
                <FaMoneyBillWave className="text-secondary" />
              </div>
              <div className={`h2 m-0 ${gastoDelta == null ? "" : gastoDelta < 0 ? "text-success" : "text-danger"}`}>
                {loading ? "…" : (kpis?.atual?.totalGasto ?? "—")}
                {!loading && <DeltaBadge value={gastoDelta} />}
              </div>
              {!loading && kpis?.anterior && (
                <div className="small text-muted mt-1">Mês anterior: R$ {(kpis.anterior.totalGasto ?? 0).toFixed(2)}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="card shadow-sm mt-4 border-0">
        <div className="card-header bg-body border-0">
          <strong>Abastecimentos do mês</strong>
        </div>
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>Data</th>
                <th>Frota</th>
                <th>Veículo</th>
                <th>Frota Nº</th>
                <th>Placa</th>
                <th>Litros</th>
                <th>Preço/L</th>
                <th>Valor Total</th>
                <th>KM Atual</th>
                <th>KM/L</th>
                <th>Combustível</th>
                <th>Posto/Obs.</th>
                <th className="text-end">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={13}>Carregando…</td>
                </tr>
              )}
              {!loading && !listaAbastFiltrada?.length && (
                <tr>
                  <td colSpan={13}>Sem registros no período.</td>
                </tr>
              )}
              {!loading &&
                listaAbastFiltrada?.map((a) => {
                  const v = mapVeic.get(a.veiculoId);
                  const dtObj =
                    typeof a.dataAbastecimento?.toDate === "function"
                      ? a.dataAbastecimento.toDate()
                      : a.dataAbastecimento?.seconds
                      ? new Date(a.dataAbastecimento.seconds * 1000)
                      : a.dataAbastecimento instanceof Date
                      ? a.dataAbastecimento
                      : null;
                  return (
                    <tr key={a.id}>
                      <td>{dtObj ? dtObj.toLocaleDateString("pt-BR") : "—"}</td>
                      <td className="text-capitalize">{a.tipoFrota || "—"}</td>
                      <td>{v?.nome || "—"}</td>
                      <td>{v?.frotaNumero || a.frotaNumero || "—"}</td>
                      <td>{(v?.placa || a.placa || "—").toUpperCase()}</td>
                      <td>{typeof a.litros === "number" ? a.litros.toFixed(2) : "—"}</td>
                      <td>{typeof a.precoPorLitro === "number" ? a.precoPorLitro.toFixed(3) : "—"}</td>
                      <td>{typeof a.valorTotal === "number" ? a.valorTotal.toFixed(2) : "—"}</td>
                      <td>{a.kmAtual ?? "—"}</td>
                      <td>{a.kmPorLitro != null ? Number(a.kmPorLitro).toFixed(3) : "—"}</td>
                      <td className="text-capitalize">{a.tipoCombustivel ?? "—"}</td>
                      <td>{a.observacao ?? "—"}</td>
                      <td className="text-end">
                        <div className="btn-group">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            title={a.imagem ? "Exibir imagem" : "Sem imagem"}
                            disabled={!a.imagem}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!a.imagem) return;
                              setImagemUrl(a.imagem);
                              setShowImagem(true);
                              return false;
                            }}
                          >
                            <FaImage />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary"
                            title="Editar"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleEditOpen(a);
                              return false;
                            }}
                          >
                            <FaEdit />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            title="Excluir"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDelete(a.id);
                              return false;
                            }}
                          >
                            <FaTrash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Lançar Abastecimento */}
      <ModalLancarAbastecimento
        open={showLancar}
        onClose={() => setShowLancar(false)}
        frotaSelecionada={frota}
        veiculos={veiculos}
        onSaved={() => {
          setTimeout(() => loadDados(), 150);
        }}
      />

      {/* Modal: Editar Abastecimento */}
      <EditarAbastecimentoModal
        open={showEditar}
        onClose={() => setShowEditar(false)}
        registro={registroSelecionado}
        veiculos={veiculos}
        onSaved={() => {
          setTimeout(() => loadDados(), 150);
        }}
      />

      {/* Modal: Exibir Imagem */}
      {showImagem && (
        <div
          onClick={() => setShowImagem(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.8)",
            zIndex: 4000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            className="bg-white rounded-3 shadow-lg"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "90vw", maxHeight: "90vh", padding: 12 }}
          >
            <div className="d-flex justify-content-between align-items-center mb-2">
              <strong>Imagem do abastecimento</strong>
              <button type="button" className="btn-close" onClick={() => setShowImagem(false)} />
            </div>
            {imagemUrl ? (
              <img
                src={imagemUrl}
                alt="Imagem do abastecimento"
                style={{ maxWidth: "100%", maxHeight: "80vh", display: "block", margin: "0 auto" }}
              />
            ) : (
              <div className="text-muted">Sem imagem.</div>
            )}
            <div className="mt-2 text-end">
              <a className="btn btn-sm btn-outline-secondary" href={imagemUrl || "#"} target="_blank" rel="noreferrer">
                Abrir em nova aba
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Overlay: Veículos */}
      <Suspense fallback={null}>
        {showVeiculos && (
          <div
            onClick={() => setShowVeiculos(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,.6)",
              zIndex: 3000,
              padding: 16,
              overflowY: "auto",
            }}
          >
            <div
              className="bg-white rounded-3 shadow-lg mx-auto"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 1100, width: "100%", padding: 16 }}
            >
              <VeiculosSection
                defaultTipoFrota={frota === "todas" ? "pesada" : frota}
                onAfterChange={() => {
                  setShowVeiculos(false);
                  setTimeout(() => {
                    (async () => {
                      const listaAtivos = await getVeiculosAtivos();
                      setVeiculos(listaAtivos);
                      await loadDados();
                    })();
                  }, 150);
                }}
              />
            </div>
          </div>
        )}
      </Suspense>
    </div>
  );
}
