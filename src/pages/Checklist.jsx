import { useState, useEffect } from "react";
import {
  collection, addDoc, serverTimestamp, getDocs, query, orderBy, where
} from "firebase/firestore";
import { db, storage } from "../services/firebase";
import { useNavigate } from "react-router-dom";

// Storage
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// Helpers dos veículos (somente ativos + validação de status)
import {
  getVeiculosAtivos,
  ensureVeiculoAtivoOrThrow,
} from "../services/veiculos";

// Itens centralizados
import checklistItems from "../data/checklistItems";

/* === Label estrita para veículo: FROTA — PLACA (sem descrição) === */
function labelVeiculo(item) {
  const frota = String(item.frotaNumero || "").trim();
  const placa = String(item.placa || "").trim();
  if (frota || placa) return [frota, placa].filter(Boolean).join(" — ");
  return item.nome || "(sem identificação)";
}

// Mapeia role para tipoChecklist permitido
const permissaoPorRole = {
  motorista: "veiculo",
  operador_empilhadeira: "equipamento",
  operador_gerador: "gerador"
};

export default function Checklist({ user, tipoChecklist }) {
  const [itemSelecionado, setItemSelecionado] = useState("");
  const [listaOpcoes, setListaOpcoes] = useState([]);

  // Campos numéricos
  const [kmAtual, setKmAtual] = useState("");
  const [ultimoKm, setUltimoKm] = useState(null);

  const [horimetroAtual, setHorimetroAtual] = useState("");
  const [ultimoHorimetro, setUltimoHorimetro] = useState(null);

  // Respostas/descrições/anexos
  const [respostas, setRespostas] = useState({});
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [descricaoNok, setDescricaoNok] = useState({});
  const [arquivoNok, setArquivoNok] = useState({});
  const [erroArquivo, setErroArquivo] = useState("");

  // Modal NOK
  const [modalAberto, setModalAberto] = useState(false);
  const [itemAtual, setItemAtual] = useState("");

  // Restrições
  const [jaEnviouHoje, setJaEnviouHoje] = useState(false);

  const navigate = useNavigate();
  const permitido = user?.role === "admin" || permissaoPorRole[user?.role] === tipoChecklist;

  /* ===== Carregar lista de opções ===== */
  useEffect(() => {
    async function fetchLista() {
      if (!permitido) return;

if (tipoChecklist === "veiculo") {
  const ativos = await getVeiculosAtivos(); 

  const apenasPesada = ativos.filter(v => String(v.tipoFrota || "")
    .trim()
    .toLowerCase() === "pesada"
  );

  setListaOpcoes(apenasPesada.map(v => ({ ...v, tipo: "veiculo" })));
  return;
}
       
      if (tipoChecklist === "equipamento") {
        const [empSnap, palSnap] = await Promise.all([
          getDocs(query(collection(db, "empilhadeiras"), orderBy("nome", "asc"))),
          getDocs(query(collection(db, "paleteiras"), orderBy("nome", "asc")))
        ]);
        const emp = empSnap.docs.map(docSnap => ({
          id: docSnap.id, ...docSnap.data(), tipo: "empilhadeira"
        }));
        const pal = palSnap.docs.map(docSnap => ({
          id: docSnap.id, ...docSnap.data(), tipo: "paleteira"
        }));
        setListaOpcoes([...emp, ...pal]);
        return;
      }

      if (tipoChecklist === "gerador") {
        const snap = await getDocs(query(collection(db, "geradores"), orderBy("nome", "asc")));
        setListaOpcoes(snap.docs.map(docSnap => ({
          id: docSnap.id, ...docSnap.data(), tipo: "gerador"
        })));
        return;
      }
    }
    fetchLista();
  }, [permitido, tipoChecklist]);

  // reset quando troca item
  useEffect(() => {
    setRespostas({});
    setKmAtual("");
    setHorimetroAtual("");
    setObs("");
    setDescricaoNok({});
    setArquivoNok({});
    setErroArquivo("");
    setUltimoKm(null);
    setUltimoHorimetro(null);
  }, [itemSelecionado]);

  // último KM / HORÍMETRO
  useEffect(() => {
    async function buscarUltimos() {
      if (!itemSelecionado) {
        setUltimoKm(null);
        setUltimoHorimetro(null);
        return;
      }

      // veiculo -> busca último KM
      if (tipoChecklist === "veiculo") {
        const qRef = query(
          collection(db, "checklists"),
          where("selecionadoId", "==", itemSelecionado),
          orderBy("dataHora", "desc")
        );
        const snap = await getDocs(qRef);
        const kms = snap.docs
          .map(doc => {
            const d = doc.data();
            const n = d.kmAtual;
            return (n !== undefined && n !== null && n !== "" && !isNaN(Number(n))) ? Number(n) : null;
          })
          .filter(v => v !== null);
        setUltimoKm(kms.length ? Math.max(...kms) : null);
        setUltimoHorimetro(null);
        return;
      }

      // equipamento -> se for empilhadeira, busca último horímetro
      if (tipoChecklist === "equipamento") {
        const selecionado = listaOpcoes.find(x => x.id === itemSelecionado);
        if (selecionado?.tipo === "empilhadeira") {
          const qRef = query(
            collection(db, "checklists"),
            where("selecionadoId", "==", itemSelecionado),
            orderBy("dataHora", "desc")
          );
          const snap = await getDocs(qRef);
          const hrs = snap.docs
            .map(doc => {
              const d = doc.data();
              const n = d.horimetroAtual;
              return (n !== undefined && n !== null && n !== "" && !isNaN(Number(n))) ? Number(n) : null;
            })
            .filter(v => v !== null);
          setUltimoHorimetro(hrs.length ? Math.max(...hrs) : null);
        } else {
          setUltimoHorimetro(null);
        }
        setUltimoKm(null);
        return;
      }

      // outros
      setUltimoKm(null);
      setUltimoHorimetro(null);
    }
    buscarUltimos();
  }, [itemSelecionado, tipoChecklist, listaOpcoes]);

  // 1 checklist por dia
  useEffect(() => {
    async function checarChecklistHoje() {
      if (!user?.uid) return;
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const qRef = query(
        collection(db, "checklists"),
        where("usuarioUid", "==", user.uid),
        orderBy("dataHora", "desc")
      );
      const snap = await getDocs(qRef);
      const fezHoje = snap.docs.some(doc => {
        const data = doc.data().dataHora?.toDate?.() || doc.data().dataHora;
        if (!data) return false;
        const d = new Date(data);
        d.setHours(0, 0, 0, 0);
        return d.getTime() === hoje.getTime();
      });
      setJaEnviouHoje(fezHoje);
    }
    checarChecklistHoje();
  }, [user]);

  // Upload NOK
  const handleArquivoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const tiposAceitos = ["image/jpeg", "image/png", "video/mp4", "video/quicktime"];
    if (!tiposAceitos.includes(file.type)) {
      setErroArquivo("Só é permitido JPG, PNG ou MP4.");
      setArquivoNok(prev => ({ ...prev, [itemAtual]: null }));
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setErroArquivo("Arquivo deve ter até 15MB.");
      setArquivoNok(prev => ({ ...prev, [itemAtual]: null }));
      return;
    }
    setErroArquivo("");
    setArquivoNok(prev => ({ ...prev, [itemAtual]: file }));
  };

  const handleChange = (item, value) => {
    setRespostas(prev => ({ ...prev, [item]: value }));
    if (value === "ok") {
      setDescricaoNok(prev => {
        const { [item]: _, ...rest } = prev;
        return rest;
      });
      setArquivoNok(prev => {
        const { [item]: _, ...rest } = prev;
        return rest;
      });
    }
    if (value === "nok") {
      setItemAtual(item);
      setModalAberto(true);
    }
  };

  const salvarDescricao = () => {
    if (!descricaoNok[itemAtual]?.trim()) {
      alert("Descrição obrigatória para itens com NOK");
      return;
    }
    setModalAberto(false);
  };

  const handleDescricaoChange = (e) => {
    setDescricaoNok(prev => ({
      ...prev,
      [itemAtual]: e.target.value
    }));
  };

  const enviarChecklist = async (e) => {
    e.preventDefault();

    // Apenas segunda/quinta
    const hoje = new Date();
    const diaSemana = hoje.getDay();
    if (!(diaSemana === 1 || diaSemana === 4)) {
      alert("Os checklists só podem ser enviados às segundas ou quintas-feiras.");
      return;
    }
    if (jaEnviouHoje) {
      alert("Você já enviou um checklist hoje.");
      return;
    }

    // Validações numéricas
    // - veículo: KM não pode diminuir
    if (tipoChecklist === "veiculo" && ultimoKm !== null && !isNaN(Number(kmAtual)) && Number(kmAtual) < ultimoKm) {
      alert(`A quilometragem atual deve ser maior ou igual à última registrada: ${ultimoKm}`);
      return;
    }
    // - empilhadeira: horímetro não pode diminuir
    const selecionado = listaOpcoes.find(x => x.id === itemSelecionado);
    const isEmpilhadeira = tipoChecklist === "equipamento" && selecionado?.tipo === "empilhadeira";
    if (isEmpilhadeira && ultimoHorimetro !== null && !isNaN(Number(horimetroAtual)) && Number(horimetroAtual) < ultimoHorimetro) {
      alert(`O horímetro atual deve ser maior ou igual ao último registrado: ${ultimoHorimetro}`);
      return;
    }

    setEnviando(true);

    try {
      // Uploads
      const arquivosEnviados = {};
      const uploads = [];

      for (const [item, file] of Object.entries(arquivoNok)) {
        if (!file) continue;

        const safeName = file.name.replace(/[?#\[\]]/g, "_");
        const path = `checklists/${user?.uid || "anon"}/${tipoChecklist}/${itemSelecionado || "sem-item"}/${Date.now()}_${safeName}`;
        const fileRef = ref(storage, path);

        const uploadTask = uploadBytes(fileRef, file, { contentType: file.type })
          .then(async (snapshot) => {
            const url = await getDownloadURL(snapshot.ref);
            arquivosEnviados[item] = { nome: file.name, tipo: file.type, url };
          });

        uploads.push(uploadTask);
      }
      if (uploads.length > 0) await Promise.all(uploads);

      // ===== Dados base do checklist =====
      let base = {
        tipo: tipoChecklist,
        usuarioUid: user?.uid || null,
        usuarioNome: user?.nome || "",
        selecionadoId: itemSelecionado,
        selecionadoNome: "",
        selecionadoDescricao: "",
        // snapshots
        veiculoId: null,
        placaSnapshot: "",
        frotaNumeroSnapshot: "",
        tipoSnapshot: "",
        // numéricos
        kmAtual: tipoChecklist === "veiculo" ? kmAtual : null,
        horimetroAtual: isEmpilhadeira ? horimetroAtual : null,
        // respostas
        respostas,
        descricaoNok,
        anexosNok: arquivosEnviados,
        obs,
        dataHora: serverTimestamp(),
      };

      if (tipoChecklist === "veiculo") {
        // Valida status e pega dados atuais do veículo
        const v = await ensureVeiculoAtivoOrThrow(itemSelecionado);
        const label = labelVeiculo(v); // "FROTA — PLACA"
        base = {
          ...base,
          veiculoId: v.id,
          selecionadoNome: label,
          selecionadoDescricao: "",
          placaSnapshot: v.placa || "",
          frotaNumeroSnapshot: v.frotaNumero || "",
          tipoSnapshot: v.tipo || "veiculo",
        };
      } else {
        // Equipamentos / geradores
        const sel = listaOpcoes.find(x => x.id === itemSelecionado);
        base = {
          ...base,
          selecionadoNome: sel?.nome || "",
          selecionadoDescricao: sel?.descricao || "",
          tipoSnapshot: sel?.tipo || "",
        };
      }

      await addDoc(collection(db, "checklists"), base);

      alert("Checklist enviado!");
      setItemSelecionado("");
      setKmAtual("");
      setHorimetroAtual("");
      setRespostas({});
      setObs("");
      setDescricaoNok({});
      setArquivoNok({});
      navigate("/");
    } catch (error) {
      let msg = "Erro ao enviar checklist!";
      if (error.message?.includes("invalid nested entity")) {
        msg = "Erro ao enviar checklist! O arquivo anexado é grande ou está corrompido.";
      }
      alert(msg + " " + error.message);
    }
    setEnviando(false);
  };

  if (!permitido) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center bg-dark text-light">
        <div className="bg-light text-dark p-5 rounded-4 shadow-lg text-center w-100" style={{ maxWidth: 420 }}>
          <h2 className="fw-bold mb-3 text-danger">Acesso negado</h2>
          <p>
            Você não tem permissão para preencher o checklist do tipo <b>{tipoChecklist}</b>.
          </p>
          <button className="mt-4 btn btn-primary fw-bold px-5 py-2" onClick={() => navigate("/")}>
            Voltar
          </button>
        </div>
      </div>
    );
  }

  // ----------- ITENS DO CHECKLIST (usando arquivo central) -----------
  let itensChecklist = [];
  if (tipoChecklist === "veiculo") {
    itensChecklist = checklistItems.veiculo;
  } else if (tipoChecklist === "equipamento") {
    const equipamentoSelecionado = listaOpcoes.find(e => e.id === itemSelecionado);
    if (equipamentoSelecionado?.tipo === "empilhadeira") {
      if (equipamentoSelecionado?.tipoEmpilhadeira === "gas") {
        itensChecklist = checklistItems.empilhadeiraGas;
      } else if (equipamentoSelecionado?.tipoEmpilhadeira === "eletrica") {
        itensChecklist = checklistItems.empilhadeiraEletrica;
      } else {
        itensChecklist = checklistItems.empilhadeiraPadrao;
      }
    } else if (equipamentoSelecionado?.tipo === "paleteira") {
      itensChecklist = equipamentoSelecionado?.tipoPaleteira === "galvanizada"
        ? checklistItems.paleteiraGalvanizada
        : checklistItems.paleteiraNormal;
    }
  } else if (tipoChecklist === "gerador") {
    itensChecklist = checklistItems.gerador;
  }

  const tituloChecklist =
    tipoChecklist === "veiculo"
      ? "Checklist do Veículo"
      : tipoChecklist === "equipamento"
      ? "Checklist de Equipamento"
      : tipoChecklist === "gerador"
      ? "Checklist do Gerador"
      : "";

  const placeholder =
    tipoChecklist === "veiculo"
      ? "Selecione o veículo"
      : tipoChecklist === "equipamento"
      ? "Selecione o equipamento"
      : tipoChecklist === "gerador"
      ? "Selecione o gerador"
      : "";

  const podeEnviar =
    !enviando &&
    itemSelecionado &&
    Object.keys(respostas).length === itensChecklist.length &&
    Object.entries(respostas).every(
      ([key, val]) => val === "ok" || (val === "nok" && descricaoNok[key]?.trim())
    );

  const selecionadoObj = listaOpcoes.find(x => x.id === itemSelecionado);
  const isEmpilhadeiraSelecionada = tipoChecklist === "equipamento" && selecionadoObj?.tipo === "empilhadeira";

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-dark text-light p-3">
      <form
        onSubmit={enviarChecklist}
        className="W-100 bg-light text-dark rounded-4 shadow-lg p-4"
        style={{ maxWidth: 660 }}
        autoComplete="off"
      >
        <button type="button" className="btn-voltar" onClick={() => navigate("/")}>
          <span style={{ fontSize: "1.5em" }}>←</span> Voltar
        </button>

        <h2 className="text-center fw-bold mb-3 text-primary">{tituloChecklist}</h2>

        {/* Select de item */}
        <div className="mb-3">
          <select
            className="form-select form-select-lg"
            value={itemSelecionado}
            onChange={e => setItemSelecionado(e.target.value)}
            required
          >
            <option value="">{placeholder}</option>
            {listaOpcoes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.tipo === "veiculo"
                  ? labelVeiculo(item) // FROTA — PLACA
                  : (
                      `${item.nome}${
                        item.tipo === "empilhadeira" && item.tipoEmpilhadeira
                          ? ` — ${item.tipoEmpilhadeira === "gas" ? "GÁS" : item.tipoEmpilhadeira === "eletrica" ? "ELÉTRICA" : ""}`
                          : ""
                      }${
                        item.tipo === "paleteira" && item.tipoPaleteira
                          ? ` — ${item.tipoPaleteira === "galvanizada" ? "GALVANIZADA" : "NORMAL"}`
                          : ""
                      }${item.descricao ? ` — ${item.descricao}` : ""}`
                    )
                }
              </option>
            ))}
          </select>
        </div>

        {/* KM para veículo */}
        {tipoChecklist === "veiculo" && itemSelecionado && (
          <div className="mb-3">
            <div className="input-group input-group-lg">
              <input
                placeholder="KM atual"
                type="number"
                className="form-control"
                value={kmAtual}
                onChange={(e) => setKmAtual(e.target.value)}
                required
                min={ultimoKm !== null ? ultimoKm : undefined}
              />
              <span className="input-group-text bg-light text-secondary" title="Último KM registrado">
                Último: {ultimoKm !== null ? ultimoKm : "--"}
              </span>
            </div>
          </div>
        )}

        {/* Horímetro para empilhadeira */}
        {isEmpilhadeiraSelecionada && (
          <div className="mb-3">
            <div className="input-group input-group-lg">
              <input
                placeholder="Horímetro atual (h)"
                type="number"
                className="form-control"
                value={horimetroAtual}
                onChange={(e) => setHorimetroAtual(e.target.value)}
                required
                min={ultimoHorimetro !== null ? ultimoHorimetro : undefined}
              />
              <span className="input-group-text bg-light text-secondary" title="Último horímetro registrado">
                Último: {ultimoHorimetro !== null ? ultimoHorimetro : "--"}
              </span>
            </div>
          </div>
        )}

        {/* Itens do checklist */}
        {itemSelecionado && (
          <div className="mb-3" style={{ maxHeight: 350, overflowY: 'auto' }}>
            {itensChecklist.map((item) => (
              <div key={item} className="mb-4 pb-2 border-bottom border-2">
                <label className="form-label fw-bold fs-5">{item}</label>
                <div className="d-flex align-items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleChange(item, "ok")}
                    className={`btn btn-lg fw-bold me-2 ${respostas[item] === "ok" ? "btn-success" : "btn-outline-secondary"}`}
                  >
                    ✅ OK
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChange(item, "nok")}
                    className={`btn btn-lg fw-bold me-2 ${respostas[item] === "nok" ? "btn-danger" : "btn-outline-secondary"}`}
                  >
                    ❌ NOK
                  </button>

                  {respostas[item] === "nok" && (
                    (descricaoNok[item]?.trim() ? (
                      <button
                        type="button"
                        className="btn btn-link p-0 text-decoration-underline fw-bold text-primary ms-2"
                        onClick={() => { setItemAtual(item); setModalAberto(true); }}
                      >
                        Editar descrição do problema
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-link p-0 text-decoration-underline fw-bold text-primary ms-2"
                        onClick={() => { setItemAtual(item); setModalAberto(true); }}
                      >
                        Adicionar descrição do problema
                      </button>
                    ))
                  )}
                </div>
                {respostas[item] === "nok" && !descricaoNok[item]?.trim() && enviando && (
                  <div className="text-danger fw-semibold mt-1 ms-1">
                    Informe a descrição do problema
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mb-3">
          <textarea
            placeholder="Observações (opcional)"
            className="form-control"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            style={{ minHeight: 70 }}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-lg w-100 fw-bold"
          disabled={!podeEnviar}
        >
          {enviando ? "Enviando..." : "Enviar Checklist"}
        </button>
      </form>

      {/* Modal descrição NOK */}
      {modalAberto && (
        <div
          className="modal fade show"
          tabIndex="-1"
          style={{
            display: 'block',
            backgroundColor: 'rgba(0,0,0,0.55)',
            position: 'fixed',
            zIndex: 1050,
            inset: 0,
          }}
          aria-modal="true"
          role="dialog"
        >
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 400 }}>
            <div className="modal-content rounded-4 shadow-lg">
              <div className="modal-header border-0 pb-0">
                <h5 className="modal-title fw-bold text-primary">Descreva o problema</h5>
                <button type="button" className="btn-close" aria-label="Close"
                  onClick={() => setModalAberto(false)} />
              </div>
              <div className="modal-body">
                <textarea
                  className="form-control mb-2"
                  rows={4}
                  placeholder={`Descrição para "${itemAtual}"`}
                  value={descricaoNok[itemAtual] || ""}
                  onChange={handleDescricaoChange}
                  autoFocus
                />
                <div className="mb-2">
                  <label className="form-label fw-bold">Anexar foto/vídeo (opcional, até 15MB)</label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,video/mp4,video/quicktime"
                    className="form-control"
                    onChange={handleArquivoChange}
                  />
                  {erroArquivo && <div className="text-danger mt-1">{erroArquivo}</div>}

                  {arquivoNok[itemAtual] && (
                    <div className="mt-2">
                      {arquivoNok[itemAtual].type?.startsWith("image/") ? (
                        <img
                          src={URL.createObjectURL(arquivoNok[itemAtual])}
                          alt="preview"
                          style={{ maxHeight: 120, borderRadius: 8 }}
                        />
                      ) : arquivoNok[itemAtual].type?.startsWith("video/") ? (
                        <div className="d-flex align-items-center gap-2">
                          <span className="badge bg-info">Vídeo selecionado</span>
                          <span>{arquivoNok[itemAtual].name}</span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer border-0 pt-0 d-flex justify-content-end">
                <button className="btn btn-secondary" onClick={() => setModalAberto(false)}>
                  Cancelar
                </button>
                <button className="btn btn-primary fw-bold" onClick={salvarDescricao}>
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
