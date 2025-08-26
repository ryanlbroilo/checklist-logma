import { useEffect, useMemo, useState } from "react";
import { collection, addDoc, serverTimestamp, query, where, orderBy, getDocs, doc, getDoc, limit } from "firebase/firestore";
import { db, auth } from "../../services/firebase";

export default function PublicAbastecimentoForm({ roles: rolesProp = [], user }) {
  const [roles, setRoles] = useState(Array.isArray(rolesProp) ? rolesProp : (user?.role ? [user.role] : []));
  const [loadingRoles, setLoadingRoles] = useState(false);

  const isAdmin = roles.includes("admin");
  const isMotorista = roles.includes("motorista");
  const isVendedor  = roles.includes("vendedor");

  // ====== Estado do formulário ======
  const [allowedFrotas, setAllowedFrotas] = useState([]); // ["leve","pesada"]
  const [tipoFrota, setTipoFrota] = useState(""); // selecionada no UI
  const [veiculos, setVeiculos] = useState([]);
  const [busca, setBusca] = useState("");
  const [veiculoId, setVeiculoId] = useState("");
  const [veiculoSel, setVeiculoSel] = useState(null);

  const [tipoCombustivel, setTipoCombustivel] = useState("");
  const [litros, setLitros] = useState("");
  const [precoPorLitro, setPrecoPorLitro] = useState("");
  const [posto, setPosto] = useState("");
  const [dataHora, setDataHora] = useState("");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // ====== Carregar roles a partir de /usuarios se não vieram por props ======
  useEffect(() => {
    (async () => {
      if (roles.length > 0) return; // já temos
      if (!auth.currentUser) return;
      setLoadingRoles(true);
      try {
        // 1) tenta /usuarios/{uid}
        const ref = doc(db, "usuarios", auth.currentUser.uid);
        const s1 = await getDoc(ref);
        if (s1.exists()) {
          const d = s1.data();
          const arr = Array.isArray(d.roles) ? d.roles : (d.role ? [String(d.role)] : []);
          if (arr.length) { setRoles(arr.map(x => String(x).toLowerCase())); return; }
        }
        // 2) fallback por email
        const email = auth.currentUser.email;
        if (email) {
          const qEmail = query(collection(db, "usuarios"), where("email", "==", email), limit(1));
          const s2 = await getDocs(qEmail);
          if (!s2.empty) {
            const d = s2.docs[0].data();
            const arr = Array.isArray(d.roles) ? d.roles : (d.role ? [String(d.role)] : []);
            if (arr.length) { setRoles(arr.map(x => String(x).toLowerCase())); return; }
          }
        }
        // 3) fallback para role vinda no objeto user (compat)
        if (user?.role) setRoles([String(user.role).toLowerCase()]);
      } finally {
        setLoadingRoles(false);
      }
    })();
  }, [roles.length, user]);

  // ====== Determina frotas permitidas conforme papel ======
  useEffect(() => {
    const f = new Set();
    if (isAdmin) { f.add("leve"); f.add("pesada"); }
    if (isMotorista) f.add("pesada");
    if (isVendedor)  f.add("leve");
    const arr = [...f];
    setAllowedFrotas(arr);
    // se só houver uma opção, pré-seleciona
    if (arr.length === 1) setTipoFrota(arr[0]);
  }, [isAdmin, isMotorista, isVendedor]);

  // ====== Carrega veículos de acordo com a frota escolhida ======
  useEffect(() => {
    (async () => {
      if (!tipoFrota) { setVeiculos([]); return; }
      try {
        // filtra por ativo + tipoFrota; orderBy placa
        const qv = query(
          collection(db, "veiculos"),
          where("status", "==", "ativo"),
          where("tipoFrota", "==", tipoFrota),
          orderBy("placa")
        );
        const snap = await getDocs(qv);
        const list = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() }));
        setVeiculos(list);
      } catch (e) {
        // Se precisar de índice composto, Firebase mostra o link. Como teste, dá pra remover o orderBy.
        console.warn("Falha ao carregar veículos:", e);
        const qv2 = query(
          collection(db, "veiculos"),
          where("status", "==", "ativo"),
          where("tipoFrota", "==", tipoFrota)
        );
        const snap2 = await getDocs(qv2);
        const list2 = [];
        snap2.forEach(d => list2.push({ id: d.id, ...d.data() }));
        setVeiculos(list2);
      }
    })();
  }, [tipoFrota]);

  const veiculosFiltrados = useMemo(() => {
    const b = (busca || "").trim().toLowerCase();
    if (!b) return veiculos;
    return veiculos.filter(v =>
      (v.placa || "").toLowerCase().includes(b) ||
      String(v.frotaNumero || "").toLowerCase().includes(b)
    );
  }, [veiculos, busca]);

  // sincroniza id => objeto selecionado
  useEffect(() => {
    setVeiculoSel(veiculos.find(v => v.id === veiculoId) || null);
  }, [veiculoId, veiculos]);

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg("");

    if (!auth.currentUser) {
      setMsg("Você precisa estar autenticado.");
      return;
    }

    // Gate correto: admin OU (motorista/vendedor)
    const canUse = isAdmin || isMotorista || isVendedor;
    if (!canUse) {
      setMsg("Você não tem permissão para lançar abastecimentos.");
      return;
    }

    if (!veiculoSel) { setMsg("Selecione um veículo."); return; }
    if (!tipoCombustivel || !litros || !precoPorLitro || !dataHora) {
      setMsg("Preencha todos os campos obrigatórios."); return;
    }

    // regra: motorista só pode 'pesada', vendedor só 'leve'
    const tipoFrotaDoc = String(veiculoSel.tipoFrota || "").toLowerCase();
    if (isMotorista && !isAdmin && tipoFrotaDoc !== "pesada") {
      setMsg("Como motorista, você só pode lançar em frota PESADA.");
      return;
    }
    if (isVendedor && !isAdmin && tipoFrotaDoc !== "leve") {
      setMsg("Como vendedor, você só pode lançar em frota LEVE.");
      return;
    }

    try {
      setSaving(true);

      const litrosNum = Number(litros);
      const pplNum = Number(precoPorLitro);
      const valorTotal = Number((litrosNum * pplNum).toFixed(2));

      await addDoc(collection(db, "abastecimentos"), {
        userId: auth.currentUser.uid,
        userNome: user?.nome || auth.currentUser.email || "",
        userRoles: roles,
        tipoFrota: tipoFrotaDoc,                // sempre do veículo
        veiculoId: veiculoSel.id,
        placa: veiculoSel.placa || "",
        frotaNumero: veiculoSel.frotaNumero || "",
        tipoCombustivel,
        litros: litrosNum,
        precoPorLitro: pplNum,
        valorTotal,
        posto: posto || "",
        dataHora: new Date(dataHora),
        criadoEm: serverTimestamp()
      });

      setMsg("Abastecimento lançado com sucesso!");

      // limpa
      setBusca("");
      setVeiculoId("");
      setVeiculoSel(null);
      // se só tinha 1 frota, mantém selecionada; senão zera:
      if (allowedFrotas.length !== 1) setTipoFrota("");
      setTipoCombustivel("");
      setLitros("");
      setPrecoPorLitro("");
      setPosto("");
      setDataHora("");
    } catch (err) {
      console.error(err);
      setMsg("Erro ao salvar. Verifique os dados e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  // Se ainda estiver resolvendo roles, segura o render do form (evita falso “sem permissão”)
  if (loadingRoles) {
    return <div className="alert alert-info">Carregando permissões…</div>;
  }

  const canUse = isAdmin || isMotorista || isVendedor;

  if (!canUse) {
    return <div className="alert alert-warning">Você não tem permissão para lançar abastecimentos.</div>;
  }

  return (
    <div className="card shadow-sm">
      <div className="card-body">
        <h5 className="card-title fw-bold">Lançar Abastecimento</h5>

        {/* Filtro de frota conforme roles */}
        <div className="mb-3">
          <label className="form-label">Frota</label>
          <select
            className="form-select"
            value={tipoFrota}
            onChange={e => setTipoFrota(e.target.value)}
          >
            <option value="">Selecione...</option>
            {(isAdmin || isVendedor) && <option value="leve">Leve</option>}
            {(isAdmin || isMotorista) && <option value="pesada">Pesada</option>}
          </select>
          <div className="form-text">
            {isAdmin ? "Admin pode lançar em leve e pesada." :
             isMotorista && isVendedor ? "Você pode lançar em leve e pesada." :
             isMotorista ? "Você pode lançar somente em frota pesada." :
             isVendedor ? "Você pode lançar somente em frota leve." : ""}
          </div>
        </div>

        {/* Busca por placa/número da frota */}
        <div className="mb-2">
          <label className="form-label">Pesquisar veículo (placa ou Nº frota)</label>
          <input
            className="form-control"
            placeholder="Ex.: ABC1D23 ou 016"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            disabled={!tipoFrota}
          />
        </div>

        {/* Lista de veículos */}
        <div className="mb-3">
          <label className="form-label">Veículo</label>
          <select
            className="form-select"
            value={veiculoId}
            onChange={e => setVeiculoId(e.target.value)}
            disabled={!tipoFrota}
          >
            <option value="">Selecione...</option>
            {veiculosFiltrados.map(v => (
              <option key={v.id} value={v.id}>
                {v.placa} — Frota {v.frotaNumero} — {v.nome || ""}
              </option>
            ))}
          </select>
        </div>

        {/* Campos do abastecimento */}
        <div className="row g-3">
          <div className="col-md-4">
            <label className="form-label">Combustível</label>
            <select className="form-select" value={tipoCombustivel} onChange={e => setTipoCombustivel(e.target.value)}>
              <option value="">Selecione...</option>
              <option value="diesel">Diesel S10/S500</option>
              <option value="gasolina">Gasolina</option>
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label">Litros</label>
            <input type="number" className="form-control" value={litros} onChange={e => setLitros(e.target.value)} min="0" step="0.01" />
          </div>
          <div className="col-md-4">
            <label className="form-label">Preço por litro</label>
            <input type="number" className="form-control" value={precoPorLitro} onChange={e => setPrecoPorLitro(e.target.value)} min="0" step="0.01" />
          </div>
          <div className="col-md-6">
            <label className="form-label">Posto</label>
            <input className="form-control" value={posto} onChange={e => setPosto(e.target.value)} />
          </div>
          <div className="col-md-6">
            <label className="form-label">Data e hora</label>
            <input type="datetime-local" className="form-control" value={dataHora} onChange={e => setDataHora(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 d-flex gap-2">
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? "Salvando..." : "Lançar"}
          </button>
          {msg && <span className="align-self-center">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
