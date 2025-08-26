import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../services/firebase";

const COLLECTION = "veiculos";

function normalizeVeiculoData(data = {}, id = "") {
  return {
    id,
    nome: data.nome || "",
    placa: data.placa || "",
    frotaNumero: data.frotaNumero || "",
    descricao: data.descricao || "",
    tipo: data.tipo || "veiculo",
    status: data.status || "ativo", // ativo | manutencao | inativo

    // 🔹 novos campos exigidos pelo módulo de abastecimento
    tipoFrota: data.tipoFrota || "",           // "leve" | "pesada"
    tipoCombustivel: data.tipoCombustivel || "", // "gasolina" | "diesel" | "etanol" | ...

    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

/** Observa a coleção de veículos (qualquer status), ordenada por nome */
export function listenVeiculos(cb) {
  const qRef = query(collection(db, COLLECTION), orderBy("nome", "asc"));
  const unsub = onSnapshot(qRef, (snap) => {
    const list = snap.docs.map((d) => normalizeVeiculoData(d.data(), d.id));
    cb(list);
  });
  return unsub;
}

/** Retorna todos os veículos com status === 'ativo', ordenados por nome */
export async function getVeiculosAtivos() {
  const qRef = query(
    collection(db, COLLECTION),
    where("status", "==", "ativo"),
    orderBy("nome", "asc")
  );
  const snap = await getDocs(qRef);
  return snap.docs.map((d) => normalizeVeiculoData(d.data(), d.id));
}

/** Busca um veículo por ID (ou null) */
export async function getVeiculoById(id) {
  if (!id) return null;
  const snap = await getDoc(doc(db, COLLECTION, id));
  return snap.exists() ? normalizeVeiculoData(snap.data(), snap.id) : null;
}

/** Garante que o veículo existe e está ATIVO – lança erro caso contrário */
export async function ensureVeiculoAtivoOrThrow(id) {
  const v = await getVeiculoById(id);
  if (!v) throw new Error("Veículo não encontrado.");
  if (v.status !== "ativo") throw new Error("Veículo indisponível (não está ativo).");
  return v;
}

/** Cria veículo (AGORA exige tipoFrota e tipoCombustivel) */
export async function addVeiculo(payload) {
  const nome = (payload.nome || "").trim();
  const placa = (payload.placa || "").trim().toUpperCase();
  const frotaNumero = (payload.frotaNumero || "").trim();
  const descricao = (payload.descricao || "").trim();
  const tipo = (payload.tipo || "veiculo").trim();
  const status = payload.status || "ativo";
  const tipoFrota = (payload.tipoFrota || "").trim().toLowerCase();
  const tipoCombustivel = (payload.tipoCombustivel || "").trim().toLowerCase();

  if (!frotaNumero || !nome || !placa) {
    throw new Error("Preencha frotaNumero, nome e placa.");
  }
  if (!["leve", "pesada"].includes(tipoFrota)) {
    throw new Error("Informe corretamente o tipoFrota (leve | pesada).");
  }
  if (!tipoCombustivel) {
    throw new Error("Informe o tipoCombustivel (ex.: gasolina, diesel, etanol).");
  }

  // (opcional) impedir placa duplicada
  const qRef = query(collection(db, COLLECTION), where("placa", "==", placa));
  const dup = await getDocs(qRef);
  if (!dup.empty) {
    throw new Error("Já existe um veículo com essa placa.");
  }

  const data = {
    nome,
    placa,
    frotaNumero,
    descricao,
    tipo,
    status,
    tipoFrota,
    tipoCombustivel,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, COLLECTION), data);
  return ref.id;
}

/** Atualiza veículo (permite alterar tipoFrota e tipoCombustivel) */
export async function updateVeiculo(id, payload) {
  const patch = {};

  if (payload.nome !== undefined) patch.nome = (payload.nome || "").trim();
  if (payload.placa !== undefined) patch.placa = (payload.placa || "").trim().toUpperCase();
  if (payload.frotaNumero !== undefined) patch.frotaNumero = (payload.frotaNumero || "").trim();
  if (payload.descricao !== undefined) patch.descricao = (payload.descricao || "").trim();
  if (payload.tipo !== undefined) patch.tipo = (payload.tipo || "veiculo").trim();
  if (payload.status !== undefined) patch.status = payload.status || "ativo";

  // 🔹 novos campos permitidos na atualização
  if (payload.tipoFrota !== undefined) {
    const tf = (payload.tipoFrota || "").trim().toLowerCase();
    if (!["leve", "pesada"].includes(tf)) {
      throw new Error("tipoFrota inválido (use 'leve' ou 'pesada').");
    }
    patch.tipoFrota = tf;
  }
  if (payload.tipoCombustivel !== undefined) {
    const tc = (payload.tipoCombustivel || "").trim().toLowerCase();
    if (!tc) throw new Error("tipoCombustivel não pode ser vazio.");
    patch.tipoCombustivel = tc;
  }

  patch.updatedAt = serverTimestamp();
  await updateDoc(doc(db, COLLECTION, id), patch);
}

/** Exclui veículo */
export async function deleteVeiculo(id) {
  await deleteDoc(doc(db, COLLECTION, id));
}

/** Marca veículo em manutenção */
export async function marcarEmManutencao(id) {
  await updateDoc(doc(db, COLLECTION, id), {
    status: "manutencao",
    updatedAt: serverTimestamp(),
  });
}

/** Marca veículo como ativo */
export async function marcarAtivo(id) {
  await updateDoc(doc(db, COLLECTION, id), {
    status: "ativo",
    updatedAt: serverTimestamp(),
  });
}
