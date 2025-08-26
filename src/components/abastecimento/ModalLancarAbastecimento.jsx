import { useEffect, useMemo, useState } from "react";
import { Timestamp } from "firebase/firestore";
import {
  addAbastecimento,
  obterUltimoKmPorVeiculo,
} from "../../services/abastecimentos";

/* ============== Modal: Lançar Abastecimento (KM/L automático) ============== */
export default function ModalLancarAbastecimento({
  open,
  onClose,
  frotaSelecionada = "todas",
  veiculos = [],
  onSaved,
}) {
  const [form, setForm] = useState({
    veiculoId: "",
    data: "",
    litros: "",
    precoPorLitro: "",
    kmAtual: "",
    kmPorLitro: "",
    posto: "",
    tipoFrota: "",
    tipoCombustivel: "",
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const [ultimoKm, setUltimoKm] = useState(null);

  // reset ao abrir
  useEffect(() => {
    if (!open) return;
    setForm({
      veiculoId: "",
      data: "",
      litros: "",
      precoPorLitro: "",
      kmAtual: "",
      kmPorLitro: "",
      posto: "",
      tipoFrota: frotaSelecionada === "todas" ? "" : frotaSelecionada,
      tipoCombustivel: "",
    });
    setUltimoKm(null);
    setErro(null);
    setSalvando(false);
  }, [open, frotaSelecionada]);

  const veiculosFiltrados = useMemo(() => {
    return frotaSelecionada === "todas"
      ? veiculos
      : veiculos.filter(
          (v) => (v.tipoFrota || "").toLowerCase() === frotaSelecionada
        );
  }, [veiculos, frotaSelecionada]);

  // buscar último KM do veículo (sem data de corte)
  useEffect(() => {
    (async () => {
      if (!form.veiculoId) {
        setUltimoKm(null);
        return;
      }
      const km = await obterUltimoKmPorVeiculo(form.veiculoId);
      setUltimoKm(km);
    })();
  }, [form.veiculoId]);

  // recalcular km/L automático
  useEffect(() => {
    const litros = Number(form.litros);
    const kmAtual = Number(form.kmAtual);
    if (litros > 0 && ultimoKm != null && isFinite(kmAtual) && kmAtual > ultimoKm) {
      const kml = (kmAtual - ultimoKm) / litros;
      setForm((f) => ({ ...f, kmPorLitro: kml.toFixed(3) }));
    } else {
      setForm((f) => ({ ...f, kmPorLitro: "" }));
    }
  }, [form.litros, form.kmAtual, ultimoKm]);

  function handleSelectVeiculo(id) {
    const v = veiculos.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      veiculoId: id,
      tipoFrota: f.tipoFrota || (v?.tipoFrota || ""),
      tipoCombustivel: f.tipoCombustivel || (v?.tipoCombustivel || ""),
    }));
  }

  async function handleSalvar(e) {
    e?.preventDefault?.();
    setErro(null);
    setSalvando(true);
    try {
      if (!form.veiculoId) throw new Error("Selecione o veículo.");
      if (!form.data) throw new Error("Informe a data.");
      if (!form.litros || Number(form.litros) <= 0)
        throw new Error("Informe os litros (> 0).");
      if (!form.precoPorLitro || Number(form.precoPorLitro) <= 0)
        throw new Error("Informe o preço por litro (> 0).");

      const tf = String(form.tipoFrota).toLowerCase();
      const tc = String(form.tipoCombustivel).toLowerCase();
      if (!["leve", "pesada"].includes(tf))
        throw new Error("Tipo de frota inválido: leve/pesada.");
      if (!tc) throw new Error("Informe o tipo de combustível.");

      const [y, m, d] = form.data.split("-").map(Number);
      // ✅ usar meio-dia LOCAL para evitar cair no dia anterior por fuso
      const jsDate = new Date(y, m - 1, d, 12, 0, 0, 0);

      const vSel = veiculos.find((vv) => vv.id === form.veiculoId);

      await addAbastecimento({
        veiculoId: form.veiculoId,
        placa: (vSel?.placa || "").toUpperCase(),
        frotaNumero: vSel?.frotaNumero || "",
        tipoFrota: tf,
        tipoCombustivel: tc,
        dataAbastecimento: Timestamp.fromDate(jsDate),
        litros: Number(form.litros),
        precoPorLitro: Number(form.precoPorLitro),
        kmAtual: form.kmAtual ? Number(form.kmAtual) : null,
        kmPorLitro: form.kmPorLitro ? Number(form.kmPorLitro) : null,
        responsavel: "",
        observacao: form.posto || "",
      });

      onSaved?.();
      onClose?.();
    } catch (e2) {
      setErro(e2?.message || "Erro ao salvar abastecimento.");
    } finally {
      setSalvando(false);
    }
  }

  if (!open) return null;
  return (
    <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,.5)" }}>
      <div className="modal-dialog modal-lg modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header border-0">
            <h5 className="modal-title fw-bold">Lançar abastecimento</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <form onSubmit={handleSalvar}>
            <div className="modal-body">
              {erro && <div className="alert alert-danger py-2">{erro}</div>}

              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Veículo *</label>
                  <select
                    className="form-select"
                    value={form.veiculoId}
                    onChange={(e) => handleSelectVeiculo(e.target.value)}
                    required
                  >
                    <option value="">Selecione...</option>
                    {veiculosFiltrados.map((v) => (
                      <option key={v.id} value={v.id}>
                        {(v.frotaNumero || "—")} — {(v.placa || "").toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-md-3">
                  <label className="form-label">Data *</label>
                  <input
                    type="date"
                    className="form-control"
                    value={form.data}
                    onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
                    required
                  />
                </div>

                <div className="col-md-3">
                  <label className="form-label">KM Atual</label>
                  <input
                    type="number"
                    className="form-control"
                    value={form.kmAtual}
                    onChange={(e) => setForm((f) => ({ ...f, kmAtual: e.target.value }))}
                    placeholder="km"
                  />
                  {ultimoKm != null && (
                    <div className="form-text">Último KM conhecido: {ultimoKm}</div>
                  )}
                </div>

                <div className="col-md-3">
                  <label className="form-label">Litros *</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-control"
                    value={form.litros}
                    onChange={(e) => setForm((f) => ({ ...f, litros: e.target.value }))}
                    required
                  />
                </div>

                <div className="col-md-3">
                  <label className="form-label">Preço por litro (R$) *</label>
                  <input
                    type="number"
                    step="0.001"
                    className="form-control"
                    value={form.precoPorLitro}
                    onChange={(e) => setForm((f) => ({ ...f, precoPorLitro: e.target.value }))}
                    required
                  />
                </div>

                <div className="col-md-3">
                  <label className="form-label">KM/L (auto)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={form.kmPorLitro}
                    readOnly
                    placeholder="auto"
                  />
                </div>

                <div className="col-md-6">
                  <label className="form-label">Posto (opcional)</label>
                  <input
                    className="form-control"
                    value={form.posto}
                    onChange={(e) => setForm((f) => ({ ...f, posto: e.target.value }))}
                  />
                </div>

                <div className="col-md-3">
                  <label className="form-label">Tipo de Frota *</label>
                  <select
                    className="form-select"
                    value={form.tipoFrota}
                    onChange={(e) => setForm((f) => ({ ...f, tipoFrota: e.target.value }))}
                    required
                  >
                    <option value="">Selecione...</option>
                    <option value="leve">Leve</option>
                    <option value="pesada">Pesada</option>
                  </select>
                </div>

                <div className="col-md-3">
                  <label className="form-label">Combustível *</label>
                  <select
                    className="form-select"
                    value={form.tipoCombustivel}
                    onChange={(e) => setForm((f) => ({ ...f, tipoCombustivel: e.target.value }))}
                    required
                  >
                    <option value="">Selecione...</option>
                    <option value="gasolina">Gasolina</option>
                    <option value="diesel">Diesel S10/S500</option>
                    <option value="arla">ARLA 32</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="modal-footer border-0">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={onClose}
                disabled={salvando}
              >
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={salvando}>
                {salvando ? "Salvando…" : "Lançar"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
