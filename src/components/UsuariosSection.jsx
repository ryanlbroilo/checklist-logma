import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  orderBy,
  query,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
} from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { db, auth } from "../services/firebase";

export default function UsuariosSection({ onReload, usuariosExternos }) {
  // Lista (vinda de fora ou carregada aqui)
  const [usuarios, setUsuarios] = useState(Array.isArray(usuariosExternos) ? usuariosExternos : []);
  const [loading, setLoading] = useState(!Array.isArray(usuariosExternos));

  // Editar
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(null); // {id, nome, email, role}
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [okMsg, setOkMsg] = useState("");

  // Cadastrar (novo)
  const [cadOpen, setCadOpen] = useState(false);
  const [cadNome, setCadNome] = useState("");
  const [cadEmail, setCadEmail] = useState("");
  const [cadSenha, setCadSenha] = useState("");
  const [cadRole, setCadRole] = useState("motorista");
  const [cadErro, setCadErro] = useState("");
  const [cadOk, setCadOk] = useState("");
  const [cadSaving, setCadSaving] = useState(false);

  async function loadUsuarios() {
    if (Array.isArray(usuariosExternos)) return; // quem controla é o AdminPanel
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "usuarios"), orderBy("nome", "asc")));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setUsuarios(list);
    } catch (e) {
      console.error(e);
      setErro("Erro ao carregar usuários.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (Array.isArray(usuariosExternos)) {
      setUsuarios(usuariosExternos);
    } else {
      loadUsuarios();
    }
  }, [usuariosExternos]);

  /* ======== Editar ======== */
  const openEdit = (u) => {
    setErro("");
    setOkMsg("");
    setEditing({ id: u.id, nome: u.nome || "", email: u.email || "", role: u.role || "motorista" });
    setEditOpen(true);
  };
  const closeEdit = () => {
    setEditOpen(false);
    setEditing(null);
    setSaving(false);
    setErro("");
    setOkMsg("");
  };
  const handleSave = async (e) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setErro("");
    setOkMsg("");

    try {
      const ref = doc(db, "usuarios", editing.id);
      // NÃO altera o e-mail no Auth — apenas no Firestore (como combinado).
      await updateDoc(ref, {
        nome: (editing.nome || "").trim(),
        email: (editing.email || "").trim(),
        role: editing.role || "motorista",
      });

      setOkMsg("Usuário atualizado com sucesso!");
      // Atualiza lista local instantaneamente
      setUsuarios((prev) => prev.map(u => u.id === editing.id ? { ...u, ...editing } : u));

      if (typeof onReload === "function") {
        try { await onReload(); } catch {}
      }

      setTimeout(closeEdit, 900);
    } catch (e) {
      console.error(e);
      setErro("Erro ao salvar. Tente novamente.");
      setSaving(false);
    }
  };

  /* ======== Excluir ======== */
  const handleDelete = async (u) => {
    if (!u?.id) return;
    if (!window.confirm(`Excluir o usuário "${u.nome || u.email}"? Isso remove o doc no Firestore (não o Auth).`)) return;
    try {
      await deleteDoc(doc(db, "usuarios", u.id));
      setUsuarios((prev) => prev.filter(x => x.id !== u.id));

      if (typeof onReload === "function") {
        try { await onReload(); } catch {}
      }
    } catch (e) {
      console.error(e);
      alert("Erro ao excluir usuário.");
    }
  };

  /* ======== Criar (Cadastro embutido) ======== */
  const openCreate = () => {
    setCadErro("");
    setCadOk("");
    setCadNome("");
    setCadEmail("");
    setCadSenha("");
    setCadRole("motorista");
    setCadOpen(true);
  };
  const closeCreate = () => {
    setCadOpen(false);
    setCadErro("");
    setCadOk("");
    setCadSaving(false);
  };
  const handleCreate = async (e) => {
    e.preventDefault();
    setCadErro("");
    setCadOk("");
    setCadSaving(true);

    try {
      const cred = await createUserWithEmailAndPassword(auth, cadEmail, cadSenha);
      await setDoc(doc(db, "usuarios", cred.user.uid), {
        nome: (cadNome || "").trim(),
        email: (cadEmail || "").trim(),
        role: cadRole || "motorista",
      });

      setCadOk("Usuário cadastrado com sucesso!");

      // Atualiza lista local
      setUsuarios(prev => {
        const novo = { id: cred.user.uid, nome: cadNome, email: cadEmail, role: cadRole };
        // insere mantendo ordenação por nome (simples)
        return [...prev, novo].sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
      });

      if (typeof onReload === "function") {
        try { await onReload(); } catch {}
      }

      setTimeout(closeCreate, 900);
    } catch (error) {
      console.error(error);
      if (error.code === "auth/email-already-in-use") setCadErro("E-mail já cadastrado.");
      else if (error.code === "auth/weak-password") setCadErro("Senha muito fraca. Use pelo menos 6 caracteres.");
      else setCadErro("Erro ao criar conta. Verifique os campos e tente novamente.");
      setCadSaving(false);
    }
  };

  return (
    <div className="card bg-light text-dark shadow border-0 mb-5">
      <div className="card-body">
        {/* Cabeçalho + botão à direita */}
        <h5 className="card-title fw-bold text-primary mb-3 d-flex align-items-center">
          Usuários cadastrados <span className="badge bg-primary ms-2">{usuarios.length}</span>
          <button
            className="btn btn-success fw-bold ms-auto"
            style={{ borderRadius: 10, fontSize: 15 }}
            onClick={openCreate}
            type="button"
          >
            + Cadastrar novo usuário
          </button>
        </h5>

        {/* Lista/Tabela */}
        {loading ? (
          <div className="text-secondary">Carregando...</div>
        ) : usuarios.length === 0 ? (
          <div>Nenhum usuário cadastrado.</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>Função</th>
                  <th style={{ width: 160 }} className="text-end">Ações</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map(u => (
                  <tr key={u.id}>
                    <td className="fw-semibold">{u.nome || "-"}</td>
                    <td>{u.email || "-"}</td>
                    <td>
                      {u.role === "motorista" ? "Motorista" :
                       u.role === "operador_empilhadeira" ? "Operador de Empilhadeira" :
                       u.role === "operador_gerador" ? "Operador de Gerador" :
                       u.role === "vendedor" ? "Vendedor" :  // ← exibindo "vendedor"
                       u.role || "-"}
                    </td>
                    <td className="text-end">
                      <button
                        className="btn btn-sm btn-outline-primary me-2"
                        onClick={() => openEdit(u)}
                      >
                        Editar
                      </button>
                      <button
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => handleDelete(u)}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== MODAL: Editar Usuário ===== */}
      {editOpen && editing && (
        <div
          className="modal fade show"
          tabIndex="-1"
          style={{
            display: "block",
            backgroundColor: "rgba(0,0,0,0.55)",
            position: "fixed",
            inset: 0,
            zIndex: 1090
          }}
          aria-modal="true"
          role="dialog"
          onClick={closeEdit}
        >
          <div
            className="modal-dialog modal-dialog-centered"
            style={{ maxWidth: 460 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content rounded-4 shadow-lg" style={{ padding: 2 }}>
              <form onSubmit={handleSave}>
                <div className="modal-header border-0 pb-0">
                  <h5 className="modal-title fw-bold text-primary">Editar Usuário</h5>
                  <button type="button" className="btn-close" onClick={closeEdit} />
                </div>
                <div className="modal-body">
                  {erro && <div className="alert alert-danger py-2">{erro}</div>}
                  {okMsg && <div className="alert alert-success py-2">{okMsg}</div>}

                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label">Nome</label>
                      <input
                        className="form-control form-control-lg"
                        value={editing.nome}
                        onChange={(e) => setEditing(prev => ({ ...prev, nome: e.target.value }))}
                        required
                        autoFocus
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label">E-mail</label>
                      <input
                        type="email"
                        className="form-control form-control-lg"
                        value={editing.email}
                        onChange={(e) => setEditing(prev => ({ ...prev, email: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Função</label>
                      <select
                        className="form-select form-select-lg"
                        value={editing.role}
                        onChange={(e) => setEditing(prev => ({ ...prev, role: e.target.value }))}
                        required
                      >
                        <option value="motorista">Motorista</option>
                        <option value="operador_empilhadeira">Operador de Empilhadeira</option>
                        <option value="operador_gerador">Operador de Gerador</option>
                        <option value="vendedor">Vendedor</option> {/* ← opção adicionada */}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="modal-footer border-0 pt-0">
                  <button type="button" className="btn btn-secondary" onClick={closeEdit}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-primary fw-bold" disabled={saving}>
                    {saving ? "Salvando..." : "Salvar alterações"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: Cadastrar Usuário ===== */}
      {cadOpen && (
        <div
          className="modal fade show"
          tabIndex="-1"
          style={{
            display: "block",
            backgroundColor: "rgba(0,0,0,0.55)",
            position: "fixed",
            inset: 0,
            zIndex: 1090
          }}
          aria-modal="true"
          role="dialog"
          onClick={closeCreate}
        >
          <div
            className="modal-dialog modal-dialog-centered"
            style={{ maxWidth: 460 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content rounded-4 shadow-lg" style={{ padding: 2 }}>
              <form onSubmit={handleCreate}>
                <div className="modal-header border-0 pb-0">
                  <h5 className="modal-title fw-bold text-primary">Cadastrar Usuário</h5>
                  <button type="button" className="btn-close" onClick={closeCreate} />
                </div>
                <div className="modal-body">
                  {cadErro && <div className="alert alert-danger py-2">{cadErro}</div>}
                  {cadOk && <div className="alert alert-success py-2">{cadOk}</div>}

                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label">Nome</label>
                      <input
                        className="form-control form-control-lg"
                        value={cadNome}
                        onChange={(e) => setCadNome(e.target.value)}
                        required
                        autoFocus
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label">E-mail</label>
                      <input
                        type="email"
                        className="form-control form-control-lg"
                        value={cadEmail}
                        onChange={(e) => setCadEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Senha</label>
                      <input
                        type="password"
                        className="form-control form-control-lg"
                        value={cadSenha}
                        onChange={(e) => setCadSenha(e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Função</label>
                      <select
                        className="form-select form-select-lg"
                        value={cadRole}
                        onChange={(e) => setCadRole(e.target.value)}
                        required
                      >
                        <option value="motorista">Motorista</option>
                        <option value="operador_empilhadeira">Operador de Empilhadeira</option>
                        <option value="operador_gerador">Operador de Gerador</option>
                        <option value="vendedor">Vendedor</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="modal-footer border-0 pt-0">
                  <button type="button" className="btn btn-secondary" onClick={closeCreate}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-primary fw-bold" disabled={cadSaving}>
                    {cadSaving ? "Salvando..." : "Registrar"}
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
