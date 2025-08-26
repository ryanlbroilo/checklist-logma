import { useEffect, useMemo, useState } from "react"; 
import {
  listenVeiculos, addVeiculo, updateVeiculo, deleteVeiculo
} from "../services/veiculos";

const STATUS_OPTIONS = [
  { value: "ativo", label: "Ativo" },
  { value: "manutencao", label: "🛠 Em manutenção" },
  { value: "inativo", label: "Inativo" },
];

function initialForm() {
  return {
    nome: "",
    placa: "",
    descricao: "",
    tipo: "",
    frotaNumero: "",
    status: "ativo",
    // 🔹 novos (obrigatórios)
    tipoFrota: "",          // "leve" | "pesada"
    tipoCombustivel: "",    // "gasolina" | "diesel" | "etanol" | ...
  };
}

export default function VeiculosSection({ onAfterChange, defaultTipoFrota = "" }) {
  const [veiculos, setVeiculos] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(initialForm());
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const unsub = listenVeiculos((list) => {
      setVeiculos(list);
      setLoading(false);
    });
    return () => unsub && unsub();
  }, []);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let result = veiculos;

    if (f) {
      result = result.filter((v) => {
        return (
          (v.nome || "").toLowerCase().includes(f) ||
          (v.placa || "").toLowerCase().includes(f) ||
          (v.tipo || "").toLowerCase().includes(f) ||
          (v.descricao || "").toLowerCase().includes(f) ||
          (v.frotaNumero || "").toLowerCase().includes(f) ||
          (v.tipoFrota || "").toLowerCase().includes(f) ||
          (v.tipoCombustivel || "").toLowerCase().includes(f)
        );
      });
    }

    // Ordena pelo número da frota
    return result.sort((a, b) => {
      const numA = parseInt(a.frotaNumero || "0", 10);
      const numB = parseInt(b.frotaNumero || "0", 10);
      return numA - numB;
    });
  }, [filter, veiculos]);

  function openCreate() {
    setEditingId(null);
    setForm({
      ...initialForm(),
      // Se vier um default do dashboard (quando abriu pelo botão lá)
      tipoFrota: defaultTipoFrota || "",
    });
    setShowForm(true);
  }

  function openEdit(item) {
    setEditingId(item.id);
    setForm({
      nome: item.nome || "",
      placa: (item.placa || "").toUpperCase(),
      descricao: item.descricao || "",
      tipo: item.tipo || "",
      frotaNumero: item.frotaNumero || "",
      status: item.status || "ativo",
      // 🔹 carregar obrigatórios
      tipoFrota: item.tipoFrota || "",
      tipoCombustivel: item.tipoCombustivel || "",
    });
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    const payload = { ...form };

    if (!payload.nome?.trim()) {
      alert("Informe o nome/modelo do veículo.");
      return;
    }
    if (!payload.frotaNumero?.trim()) {
      alert("Informe o número da frota.");
      return;
    }
    if (!payload.placa?.trim()) {
      alert("Informe a placa.");
      return;
    }
    if (!["leve", "pesada"].includes(String(payload.tipoFrota).toLowerCase())) {
      alert("Selecione o Tipo de Frota (leve ou pesada).");
      return;
    }
    if (!String(payload.tipoCombustivel).trim()) {
      alert("Selecione o Tipo de Combustível.");
      return;
    }

    // Normalizações
    payload.placa = payload.placa.toUpperCase();
    payload.tipoFrota = String(payload.tipoFrota).toLowerCase();
    payload.tipoCombustivel = String(payload.tipoCombustivel).toLowerCase();

    try {
      if (editingId) {
        await updateVeiculo(editingId, payload);
        onAfterChange?.({ type: "updated" });
      } else {
        await addVeiculo(payload);
        onAfterChange?.({ type: "created" });
      }
      setShowForm(false);
      setEditingId(null);
      setForm(initialForm());
    } catch (err) {
      console.error(err);
      alert(err?.message || "Erro ao salvar veículo.");
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Deseja remover este veículo?")) return;
    try {
      await deleteVeiculo(id);
      onAfterChange?.({ type: "deleted" });
    } catch (err) {
      console.error(err);
      alert("Erro ao excluir veículo.");
    }
  }

  return (
    <div className="card shadow-sm mb-4">
      <div className="card-header d-flex align-items-center justify-content-between">
        <h5 className="card-title fw-bold text-primary mb-3 d-flex align-items-center">
          Veículos cadastrados
          <span className="badge bg-primary ms-2">{veiculos.length}</span>
        </h5>
        <div className="d-flex gap-2">
          <input
            type="text"
            className="form-control"
            placeholder="Filtrar (nome/placa/tipo/frota/combustível)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          <button className="btn btn-primary" onClick={openCreate}>
            + Cadastrar veículo
          </button>
        </div>
      </div>

      <div className="card-body p-0">
        {loading ? (
          <div className="p-3">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-3">Nenhum veículo encontrado.</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead className="table-light">
                <tr>
                  <th>Nome/Modelo</th>
                  <th>Placa</th>
                  <th>Tipo</th>
                  <th>Descrição</th>
                  <th>Frota</th>
                  <th>Status</th>
                  <th>Frota (leve/pesada)</th>
                  <th>Combustível</th>
                  <th style={{ width: 160 }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <tr key={v.id}>
                    <td>{v.nome || "-"}</td>
                    <td>{(v.placa || "").toUpperCase() || "-"}</td>
                    <td>{v.tipo || "-"}</td>
                    <td>{v.descricao || "-"}</td>
                    <td>{v.frotaNumero || "-"}</td>
                    <td>
                      {v.status === "ativo" && <span className="badge bg-success">Ativo</span>}
                      {v.status === "manutencao" && <span className="badge bg-warning text-dark">Em manutenção</span>}
                      {v.status === "inativo" && <span className="badge bg-secondary">Inativo</span>}
                    </td>
                    <td className="text-capitalize">{v.tipoFrota || "-"}</td>
                    <td className="text-capitalize">{v.tipoCombustivel || "-"}</td>
                    <td>
                      <div className="d-flex gap-2">
                        <button className="btn btn-sm btn-outline-primary" onClick={() => openEdit(v)}>
                          Editar
                        </button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(v.id)}>
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal com backdrop embutido + z-index garantido */}
      {showForm && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowForm(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.55)", // backdrop
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16
          }}
        >
          <div
            className="modal-dialog modal-lg"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 900, width: "100%" }}
          >
            <div
              className="modal-content rounded-3 shadow-lg"
              style={{
                backgroundColor: "#ffffff",
                color: "#212529",
                zIndex: 2001
              }}
            >
              <form onSubmit={handleSubmit}>
                <div className="modal-header" style={{ padding: "1.5rem 1.5rem" }}>
                  <h5 className="modal-title">
                    {editingId ? "Editar veículo" : "Cadastrar veículo"}
                  </h5>
                  <button type="button" className="btn-close" onClick={() => setShowForm(false)} />
                </div>

                <div className="modal-body" style={{ padding: "1.5rem" }}>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label">Nome/Modelo *</label>
                      <input
                        className="form-control"
                        value={form.nome}
                        onChange={(e) => setForm((s) => ({ ...s, nome: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label">Placa *</label>
                      <input
                        className="form-control text-uppercase"
                        value={form.placa}
                        onChange={(e) => setForm((s) => ({ ...s, placa: e.target.value.toUpperCase() }))}
                        required
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label">Frota/Nº *</label>
                      <input
                        className="form-control"
                        value={form.frotaNumero}
                        onChange={(e) => setForm((s) => ({ ...s, frotaNumero: e.target.value }))}
                        required
                      />
                    </div>

                    <div className="col-md-4">
                      <label className="form-label">Tipo</label>
                      <input
                        className="form-control"
                        placeholder="veiculo / equipamento / gerador / empilhadeira..."
                        value={form.tipo}
                        onChange={(e) => setForm((s) => ({ ...s, tipo: e.target.value }))}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Status</label>
                      <select
                        className="form-select"
                        value={form.status}
                        onChange={(e) => setForm((s) => ({ ...s, status: e.target.value }))}
                      >
                        {STATUS_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* 🔹 NOVOS CAMPOS OBRIGATÓRIOS */}
                    <div className="col-md-4">
                      <label className="form-label">Tipo de Frota *</label>
                      <select
                        className="form-select"
                        value={form.tipoFrota}
                        onChange={(e) => setForm((s) => ({ ...s, tipoFrota: e.target.value }))}
                        required
                      >
                        <option value="">Selecione...</option>
                        <option value="leve">Leve</option>
                        <option value="pesada">Pesada</option>
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Combustível *</label>
                      <select
                        className="form-select"
                        value={form.tipoCombustivel}
                        onChange={(e) => setForm((s) => ({ ...s, tipoCombustivel: e.target.value }))}
                        required
                      >
                        <option value="">Selecione...</option>
                        <option value="gasolina">Gasolina</option>
                        <option value="diesel">Diesel S10/S500</option>
                      </select>
                    </div>

                    <div className="col-md-12">
                      <label className="form-label">Descrição</label>
                      <textarea
                        className="form-control"
                        rows={3}
                        value={form.descricao}
                        onChange={(e) => setForm((s) => ({ ...s, descricao: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="modal-footer" style={{ padding: "1.5rem" }}>
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowForm(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {editingId ? "Salvar alterações" : "Cadastrar"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
