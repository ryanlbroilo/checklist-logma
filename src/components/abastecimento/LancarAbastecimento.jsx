// src/components/abastecimento/LancarAbastecimento.jsx
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
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

import { db, storage, auth } from "../../services/firebase";

export default function LancarAbastecimento({
  publicMode = false,                  // se true, restringe por allowedFrotas
  allowedFrotas = ["leve", "pesada"],  // em modo público, quais frotas são aceitas
  lockFrota = false,                   // se true, trava o seletor de frota
  defaultFrota = "",                   // valor inicial quando lockFrota = true
  hideSearch = false,                  // se true, esconde a busca por veículo
}) {
  const navigate = useNavigate();

  // filtros e seleção
  const [tipoFrota, setTipoFrota] = useState(defaultFrota || "");
  const [veiculos, setVeiculos] = useState([]);
  const [busca, setBusca] = useState("");

  const [veiculoId, setVeiculoId] = useState("");
  const [veiculoSel, setVeiculoSel] = useState(null);

  // dados do abastecimento
  const [tipoCombustivel, setTipoCombustivel] = useState("");
  const [litros, setLitros] = useState("");
  const [precoPorLitro, setPrecoPorLitro] = useState("");
  const [posto, setPosto] = useState("");
  const [dataHora, setDataHora] = useState(""); // datetime-local

  // upload de imagem
  const [image, setImage] = useState(null);

  // UI
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // quando defaultFrota mudar (via props), atualiza (ex.: troca de usuário)
  useEffect(() => {
    if (defaultFrota) setTipoFrota(defaultFrota);
  }, [defaultFrota]);

  // Carrega veículos conforme tipoFrota escolhido
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
      } catch (e) {
        // fallback sem orderBy (caso precise de índice)
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

  // Upload de imagem: valida tamanho
  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setImage(null);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMsg("O arquivo deve ser menor que 10MB.");
      setImage(null);
      return;
    }
    setImage(file);
  };

  // Sobe a imagem em abastecimentos/{uid}/{docId}/{nome}, compatível com suas rules
  async function uploadImageForDoc(file, uid, docId) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    // suas rules aceitam image/* ou application/pdf
    const fallback = ext === "pdf" ? "application/pdf" : "image/jpeg";
    const metadata = { contentType: file.type || fallback };

    const nomeArq = `${Date.now()}_${file.name}`;
    const caminho = `abastecimentos/${uid}/${docId}/${nomeArq}`;
    const imageRef = ref(storage, caminho);

    await uploadBytes(imageRef, file, metadata);
    const url = await getDownloadURL(imageRef);
    return url;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg("");

    // precisa estar autenticado
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setMsg("Você precisa estar autenticado.");
      return;
    }

    if (!veiculoSel) {
      setMsg("Selecione um veículo.");
      return;
    }
    if (!tipoCombustivel || !litros || !precoPorLitro || !dataHora) {
      setMsg("Preencha todos os campos obrigatórios.");
      return;
    }

    // 🔒 Em modo público, garanta que a frota do veículo é permitida
    const tipoFrotaDoVeiculo = String(veiculoSel.tipoFrota || "").toLowerCase();
    if (publicMode && !allowedFrotas.includes(tipoFrotaDoVeiculo)) {
      setMsg("Você não tem permissão para lançar nessa frota.");
      return;
    }

    try {
      setSaving(true);

      const litrosNum = Number(litros);
      const pplNum = Number(precoPorLitro);
      const valorTotal = Number((litrosNum * pplNum).toFixed(2));

      // 1) cria o documento primeiro (sem imagem)
      const refDoc = await addDoc(collection(db, "abastecimentos"), {
        userId: uid,
        tipoFrota: tipoFrotaDoVeiculo, // SEMPRE do veículo selecionado
        veiculoId: veiculoSel.id,
        placa: veiculoSel.placa || "",
        frotaNumero: veiculoSel.frotaNumero || "",
        tipoCombustivel,
        litros: litrosNum,
        precoPorLitro: pplNum,
        valorTotal,
        posto: posto || "",
        dataHora: new Date(dataHora),
        criadoEm: serverTimestamp(),
      });

      // 2) se houver imagem, faz upload no caminho permitido e atualiza o doc
      if (image) {
        const url = await uploadImageForDoc(image, uid, refDoc.id);
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
      setDataHora("");
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
        {/* Botão Voltar */}
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
                <option value="">Selecione.</option>
                {allowedFrotas.includes("leve") && <option value="leve">Leve</option>}
                {allowedFrotas.includes("pesada") && <option value="pesada">Pesada</option>}
              </select>
            </div>
          ) : (
            // travado: mostra só um texto
            <div className="mb-3">
              <label className="form-label d-block">Frota</label>
              <span className="badge bg-secondary text-uppercase">
                {defaultFrota || tipoFrota}
              </span>
            </div>
          )}

          {/* (Opcional) Busca veículo — oculto se hideSearch */}
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
              <option value="">Selecione.</option>
              {veiculosFiltrados.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.placa} — Frota {v.frotaNumero} — {v.nome || ""}
                </option>
              ))}
            </select>
          </div>

          {/* Dados do abastecimento */}
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">Combustível</label>
              <select
                className="form-select"
                value={tipoCombustivel}
                onChange={(e) => setTipoCombustivel(e.target.value)}
              >
                <option value="">Selecione.</option>
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

            <div className="col-md-6">
              <label className="form-label">Posto</label>
              <input
                className="form-control"
                value={posto}
                onChange={(e) => setPosto(e.target.value)}
              />
            </div>

            <div className="col-md-6">
              <label className="form-label">Data e hora</label>
              <input
                type="datetime-local"
                className="form-control"
                value={dataHora}
                onChange={(e) => setDataHora(e.target.value)}
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
