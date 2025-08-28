import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

import { db, storage, auth } from "../../services/firebase";
import { obterUltimoKmPorVeiculo } from "../../services/abastecimentos";

export default function LancarAbastecimento({
  publicMode = false,
  allowedFrotas: allowedFrotasProp = ["leve", "pesada"],
  lockFrota: lockFrotaProp = false,
  defaultFrota: defaultFrotaProp = "",
  hideSearch = false,
}) {
  const navigate = useNavigate();

  // ===== Role / Frota =====
  const [role, setRole] = useState("admin");
  const [tipoFrota, setTipoFrota] = useState(defaultFrotaProp || "");
  const [lockFrota, setLockFrota] = useState(lockFrotaProp);
  const [allowedFrotas, setAllowedFrotas] = useState(allowedFrotasProp);

  useEffect(() => {
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const token = await user.getIdTokenResult();
        const r = token.claims?.role || token.claims?.perfil || "admin";
        setRole(r);

        // Aplica regra por role
        if (r === "vendedor") {
          setAllowedFrotas(["leve"]);
          setTipoFrota("leve");
          setLockFrota(true);
        } else if (r === "motorista") {
          setAllowedFrotas(["pesada"]);
          setTipoFrota("pesada");
          setLockFrota(true);
        } else {
          // admin
          setAllowedFrotas(["leve", "pesada"]);
          setLockFrota(lockFrotaProp);
          if (!defaultFrotaProp) setTipoFrota("");
        }
      } catch {
        // fallback admin
        setRole("admin");
        setAllowedFrotas(["leve", "pesada"]);
        setLockFrota(lockFrotaProp);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Veículos / Busca =====
  const [veiculos, setVeiculos] = useState([]);
  const [busca, setBusca] = useState("");
  const [veiculoId, setVeiculoId] = useState("");
  const [veiculoSel, setVeiculoSel] = useState(null);

  useEffect(() => {
    (async () => {
      if (!tipoFrota) {
        setVeiculos([]);
        return;
      }
      try {
        const qv = query(
          collection(db, "veiculos"),
          where("status", "==", "ativo"),
          where("tipoFrota", "==", tipoFrota),
          orderBy("placa")
        );
        const snap = await getDocs(qv);
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setVeiculos(list);
      } catch {
        // fallback sem orderBy
        const qv2 = query(
          collection(db, "veiculos"),
          where("status", "==", "ativo"),
          where("tipoFrota", "==", tipoFrota)
        );
        const snap2 = await getDocs(qv2);
        const list2 = snap2.docs.map((d) => ({ id: d.id, ...d.data() }));
        setVeiculos(list2);
      }
    })();
  }, [tipoFrota]);

  useEffect(() => {
    setVeiculoSel(veiculos.find((v) => v.id === veiculoId) || null);
  }, [veiculoId, veiculos]);

  const veiculosFiltrados = useMemo(() => {
    const b = (busca || "").trim().toLowerCase();
    if (hideSearch || !b) return veiculos;
    return veiculos.filter(
      (v) =>
        (v.placa || "").toLowerCase().includes(b) ||
        String(v.frotaNumero || "").toLowerCase().includes(b)
    );
  }, [veiculos, busca, hideSearch]);

  // ===== Abastecimento: campos =====
  const [tipoCombustivel, setTipoCombustivel] = useState("");
  const [litros, setLitros] = useState("");
  const [precoPorLitro, setPrecoPorLitro] = useState("");
  const [posto, setPosto] = useState("");
  const [data, setData] = useState(""); // input type="date"

  // KM/L automático
  const [kmAtual, setKmAtual] = useState("");
  const [kmPorLitro, setKmPorLitro] = useState("");
  const [ultimoKm, setUltimoKm] = useState(null);

  useEffect(() => {
    (async () => {
      if (!veiculoId) {
        setUltimoKm(null);
        return;
      }
      const km = await obterUltimoKmPorVeiculo(veiculoId);
      setUltimoKm(km);
    })();
  }, [veiculoId]);

  useEffect(() => {
    const l = Number(litros);
    const kmA = Number(kmAtual);
    if (l > 0 && ultimoKm != null && isFinite(kmA) && kmA > ultimoKm) {
      const kml = (kmA - ultimoKm) / l;
      setKmPorLitro(kml.toFixed(3));
    } else {
      setKmPorLitro("");
    }
  }, [litros, kmAtual, ultimoKm]);

  // ===== Upload imagem =====
  const [image, setImage] = useState(null);

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setImage(null);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("O arquivo deve ser menor que 10MB.");
      setImage(null);
      return;
    }
    setImage(file);
  };

  async function uploadImage(uid, docId, file) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    const fallback = ext === "pdf" ? "application/pdf" : "image/jpeg";
    const metadata = { contentType: file.type || fallback };
    const nomeArq = `${Date.now()}_${file.name}`;
    const caminho = `abastecimentos/${uid}/${docId}/${nomeArq}`;
    const imageRef = ref(storage, caminho);
    await uploadBytes(imageRef, file, metadata);
    return await getDownloadURL(imageRef);
  }

  // ===== Submit =====
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg("");

    const uid = auth.currentUser?.uid;
    if (!uid) return setMsg("Você precisa estar autenticado.");
    if (!veiculoSel) return setMsg("Selecione um veículo.");
    if (!tipoCombustivel || !litros || !precoPorLitro || !data) {
      return setMsg("Preencha todos os campos obrigatórios.");
    }

    // 🔒 Bloqueio de KM: não permite kmAtual menor/igual ao último KM conhecido
    if (ultimoKm != null) {
      const kmA = Number(kmAtual);
      if (!isFinite(kmA) || kmA <= ultimoKm) {
        return setMsg(`KM Atual deve ser maior que o último KM conhecido (${ultimoKm}).`);
      }
    }

    // Restrições em modo público
    const tipoFrotaDoVeiculo = String(veiculoSel.tipoFrota || "").toLowerCase();
    if (publicMode && !allowedFrotas.includes(tipoFrotaDoVeiculo)) {
      return setMsg("Você não tem permissão para lançar nessa frota.");
    }

    try {
      setSaving(true);

      const litrosNum = Number(litros);
      const pplNum = Number(precoPorLitro);
      const valorTotal = Number((litrosNum * pplNum).toFixed(2));

      // usar meio-dia LOCAL para evitar problemas de fuso caindo no dia anterior
      const [y, m, d] = String(data).split("-").map(Number);
      const jsDate = new Date(y, m - 1, d, 12, 0, 0, 0);

      // 1) cria o documento sem a imagem
      const refDoc = await addDoc(collection(db, "abastecimentos"), {
        userId: uid,
        tipoFrota: tipoFrotaDoVeiculo,
        veiculoId: veiculoSel.id,
        placa: veiculoSel.placa || "",
        frotaNumero: veiculoSel.frotaNumero || "",
        tipoCombustivel,
        litros: litrosNum,
        precoPorLitro: pplNum,
        valorTotal,
        posto: posto || "",
        dataAbastecimento: Timestamp.fromDate(jsDate),
        kmAtual: kmAtual ? Number(kmAtual) : null,
        kmPorLitro: kmPorLitro ? Number(kmPorLitro) : null,
        criadoEm: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 2) upload opcional da imagem
      if (image) {
        const url = await uploadImage(uid, refDoc.id, image);
        await updateDoc(doc(db, "abastecimentos", refDoc.id), {
          imagem: url,
          updatedAt: serverTimestamp(),
        });
      }

      setMsg("Abastecimento lançado com sucesso!");
      setVeiculoId("");
      setVeiculoSel(null);
      if (!lockFrota) setTipoFrota("");
      setTipoCombustivel("");
      setLitros("");
      setPrecoPorLitro("");
      setPosto("");
      setData("");
      setKmAtual("");
      setKmPorLitro("");
      setBusca("");
      setImage(null);
    } catch (err) {
      console.error(err);
      setMsg("Erro ao salvar. Verifique os dados e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card shadow-sm">
      <div className="card-body">
        <button type="button" className="btn-voltar" onClick={() => navigate("/")}>
          ← Voltar
        </button>

        <h5 className="card-title fw-bold">
          {publicMode ? "Lançar Abastecimento" : "Novo Abastecimento"}
        </h5>

        <form onSubmit={handleSubmit}>
          {/* Frota */}
          {!lockFrota ? (
            <div className="mb-3">
              <label className="form-label">Frota</label>
              <select
                className="form-select"
                value={tipoFrota}
                onChange={(e) => setTipoFrota(e.target.value)}
              >
                <option value="">Selecione...</option>
                {allowedFrotas.includes("leve") && <option value="leve">Leve</option>}
                {allowedFrotas.includes("pesada") && <option value="pesada">Pesada</option>}
              </select>
            </div>
          ) : (
            <div className="mb-3">
              <label className="form-label d-block">Frota</label>
              <span className="badge bg-secondary text-uppercase">
                {tipoFrota || defaultFrotaProp}
              </span>
            </div>
          )}

          {/* Busca veículo */}
          {!hideSearch && (
            <div className="mb-2">
              <label className="form-label">Pesquisar veículo (placa ou Nº frota)</label>
              <input
                className="form-control"
                placeholder="Ex.: ABC1D23 ou 016"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                disabled={!tipoFrota}
              />
            </div>
          )}

          {/* Veículo */}
          <div className="mb-3">
            <label className="form-label">Veículo</label>
            <select
              className="form-select"
              value={veiculoId}
              onChange={(e) => setVeiculoId(e.target.value)}
              disabled={!tipoFrota}
            >
              <option value="">Selecione...</option>
              {veiculosFiltrados.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.placa} — Frota {v.frotaNumero} — {v.nome || ""}
                </option>
              ))}
            </select>
          </div>

          {/* Campos abastecimento */}
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">Combustível</label>
              <select
                className="form-select"
                value={tipoCombustivel}
                onChange={(e) => setTipoCombustivel(e.target.value)}
              >
                <option value="">Selecione...</option>
                <option value="diesel">Diesel S10/S500</option>
                <option value="gasolina">Gasolina</option>
                <option value="arla">ARLA 32</option>
              </select>
            </div>

            <div className="col-md-4">
              <label className="form-label">Litros</label>
              <input
                type="number"
                className="form-control"
                value={litros}
                onChange={(e) => setLitros(e.target.value)}
                min="0"
                step="0.01"
              />
            </div>

            <div className="col-md-4">
              <label className="form-label">Preço por litro</label>
              <input
                type="number"
                className="form-control"
                value={precoPorLitro}
                onChange={(e) => setPrecoPorLitro(e.target.value)}
                min="0"
                step="0.01"
              />
            </div>

            <div className="col-md-4">
              <label className="form-label">KM Atual</label>
              <input
                type="number"
                className="form-control"
                value={kmAtual}
                onChange={(e) => setKmAtual(e.target.value)}
                placeholder="km"
              />
              {ultimoKm != null && (
                <div className="form-text">Último KM conhecido: {ultimoKm}</div>
              )}
            </div>

            <div className="col-md-4">
              <label className="form-label">KM/L (auto)</label>
              <input type="text" className="form-control" value={kmPorLitro} readOnly />
            </div>

            <div className="col-md-4">
              <label className="form-label">Data do abastecimento</label>
              <input
                type="date"
                className="form-control"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>

            <div className="col-md-6">
              <label className="form-label">Posto</label>
              <input
                className="form-control"
                value={posto}
                onChange={(e) => setPosto(e.target.value)}
              />
            </div>
          </div>

          {/* Upload de imagem */}
          <div className="mb-3 mt-3">
            <label className="form-label">Upload de Imagem (até 10MB)</label>
            <input
              type="file"
              className="form-control"
              accept="image/*,application/pdf"
              onChange={handleImageChange}
            />
          </div>

          <button className="btn btn-primary mt-3" type="submit" disabled={saving}>
            {saving ? "Salvando..." : "Lançar"}
          </button>
          {msg && <div className="mt-3">{msg}</div>}
        </form>
      </div>
    </div>
  );
}
