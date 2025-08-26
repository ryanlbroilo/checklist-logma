import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../services/firebase";

const COLLECTION = "abastecimentos";

// Config de thresholds (alvos R$/L)
const CONFIG_COLLECTION = "config_abastecimento";
const CONFIG_DOC_ID = "global";

/** Normaliza registro vindo do Firestore */
function normalizeAbastecimento(d = {}, id = "") {
  return {
    id,
    veiculoId: d.veiculoId || "",
    placa: d.placa || "",
    frotaNumero: d.frotaNumero || "",
    tipoFrota: d.tipoFrota || "",              // "leve" | "pesada"
    tipoCombustivel: d.tipoCombustivel || "",  // "gasolina" | "diesel" | ...
    litros: Number(d.litros ?? 0),
    precoPorLitro: Number(d.precoPorLitro ?? 0),
    valorTotal: Number(d.valorTotal ?? 0),

    kmAtual: d.kmAtual != null ? Number(d.kmAtual) : null,
    kmPorLitro: d.kmPorLitro != null ? Number(d.kmPorLitro) : null,

    responsavel: d.responsavel || "",
    observacao: d.observacao || "",

    dataAbastecimento: d.dataAbastecimento || null, // Timestamp
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
  };
}

/** Converte várias formas de data para Timestamp */
function toTimestamp(anyDate) {
  if (anyDate instanceof Timestamp) return anyDate;
  if (anyDate instanceof Date) return Timestamp.fromDate(anyDate);
  if (typeof anyDate === "string") {
    const d = new Date(anyDate);
    if (!isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  return serverTimestamp(); // fallback
}

/** Cria um abastecimento */
export async function criarAbastecimento(payload = {}) {
  const {
    veiculoId = "",
    placa = "",
    frotaNumero = "",
    tipoFrota = "",
    tipoCombustivel = "",
    litros,
    precoPorLitro,
    valorTotal,
    kmAtual = null,
    kmPorLitro = null,
    dataAbastecimento,
    responsavel = "",
    observacao = "",
  } = payload;

  if (!veiculoId) throw new Error("veiculoId é obrigatório.");

  const tf = String(tipoFrota).toLowerCase();
  if (!["leve", "pesada"].includes(tf)) {
    throw new Error("tipoFrota inválido (use 'leve' ou 'pesada').");
  }
  const tc = String(tipoCombustivel).toLowerCase();
  if (!tc) throw new Error("tipoCombustivel é obrigatório.");

  const l = Number(litros);
  const ppl = Number(precoPorLitro);
  if (!l || l <= 0) throw new Error("Litros deve ser maior que 0.");
  if (!ppl || ppl <= 0) throw new Error("Preço por litro deve ser maior que 0.");

  const total = valorTotal != null ? Number(valorTotal) : Number((l * ppl).toFixed(2));

  const docData = {
    veiculoId,
    placa: String(placa || "").toUpperCase(),
    frotaNumero: String(frotaNumero || "").trim(),
    tipoFrota: tf,
    tipoCombustivel: tc,
    litros: l,
    precoPorLitro: ppl,
    valorTotal: total,

    kmAtual: kmAtual != null ? Number(kmAtual) : null,
    kmPorLitro: kmPorLitro != null ? Number(kmPorLitro) : null,

    responsavel,
    observacao,

    dataAbastecimento: toTimestamp(dataAbastecimento),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, COLLECTION), docData);
  return ref.id;
}

/** Alias para compatibilidade com o Dashboard */
export const addAbastecimento = criarAbastecimento;

/** Pega o último KM (kmAtual) lançado para um veículo */
export async function obterUltimoKmPorVeiculo(veiculoId) {
  if (!veiculoId) return null;

  const qRef = query(
    collection(db, COLLECTION),
    where("veiculoId", "==", veiculoId),
    orderBy("dataAbastecimento", "desc"),
    limit(1)
  );

  const snap = await getDocs(qRef);
  const doc0 = snap.docs[0];
  const r = doc0 ? normalizeAbastecimento(doc0.data(), doc0.id) : null;

  return r?.kmAtual != null ? Number(r.kmAtual) : null;
}

/**
 * Lista abastecimentos do mês/ano (opcionalmente filtrado por tipo de frota)
 */
export async function listarAbastecimentos({ mes, ano, tipoFrota } = {}) {
  if (!mes || !ano) {
    const base = tipoFrota
      ? query(
          collection(db, COLLECTION),
          where("tipoFrota", "==", tipoFrota),
          orderBy("dataAbastecimento", "desc")
        )
      : query(collection(db, COLLECTION), orderBy("dataAbastecimento", "desc"));

    const snap = await getDocs(base);
    return snap.docs.map((d) => normalizeAbastecimento(d.data(), d.id));
  }

  // início e fim do mês (em horário local)
  const startLocal = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
  const endLocal = new Date(ano, mes, 1, 0, 0, 0, 0);

  const startTs = Timestamp.fromDate(startLocal);
  const endTs = Timestamp.fromDate(endLocal);

  const base = tipoFrota
    ? query(
        collection(db, COLLECTION),
        where("tipoFrota", "==", tipoFrota),
        where("dataAbastecimento", ">=", startTs),
        where("dataAbastecimento", "<", endTs),
        orderBy("dataAbastecimento", "desc")
      )
    : query(
        collection(db, COLLECTION),
        where("dataAbastecimento", ">=", startTs),
        where("dataAbastecimento", "<", endTs),
        orderBy("dataAbastecimento", "desc")
      );

  const snap = await getDocs(base);
  return snap.docs.map((d) => normalizeAbastecimento(d.data(), d.id));
}

/** Deleta um abastecimento */
export async function deleteAbastecimento(id) {
  try {
    const ref = doc(db, COLLECTION, id);
    await deleteDoc(ref);
    console.log("Abastecimento excluído com sucesso");
  } catch (error) {
    console.error("Erro ao excluir abastecimento: ", error);
    throw new Error("Erro ao excluir abastecimento");
  }
}

export async function updateAbastecimento(id, patch = {}) {
  if (!id) throw new Error("id é obrigatório para atualizar.");

  // Campos permitidos para atualização
  const allowed = [
    "veiculoId",
    "placa",
    "frotaNumero",
    "tipoFrota",
    "tipoCombustivel",
    "litros",
    "precoPorLitro",
    "valorTotal",
    "kmAtual",
    "kmPorLitro",
    "responsavel",
    "observacao",
    "dataAbastecimento",
  ];

  const data = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) data[k] = patch[k];
  }

  // Se não veio valorTotal, mas veio litros e preço, recalcule
  if (
    data.valorTotal === undefined &&
    (patch.litros !== undefined || patch.precoPorLitro !== undefined)
  ) {
    const litros = typeof patch.litros === "number" ? patch.litros : undefined;
    const ppl = typeof patch.precoPorLitro === "number" ? patch.precoPorLitro : undefined;
    if (typeof litros === "number" && typeof ppl === "number") {
      data.valorTotal = Number((litros * ppl).toFixed(2));
    }
  }

  data.updatedAt = serverTimestamp();

  const ref = doc(db, COLLECTION, id);
  await updateDoc(ref, data);
  return true;
}

/** KPIs com comparativo (mês atual vs anterior) */
export async function calcularKpisComComparativo(params = {}) {
  const { mes, ano, alvoPrecoLeve, alvoPrecoPesada, tipoFrota } = params;

  const atualTodos = await listarAbastecimentos({ mes, ano, tipoFrota });
  let prevMes = mes - 1;
  let prevAno = ano;
  if (prevMes < 1) {
    prevMes = 12;
    prevAno = ano - 1;
  }
  const anteriorTodos = await listarAbastecimentos({ mes: prevMes, ano: prevAno, tipoFrota });

  const calc = (items) => {
    const somaValor = items.reduce((acc, i) => acc + Number(i.valorTotal || 0), 0);
    const somaLitros = items.reduce((acc, i) => acc + Number(i.litros || 0), 0);
    const precoMedio = somaLitros > 0 ? somaValor / somaLitros : 0;

    const somaKm = items.reduce((acc, i) => {
      const kml = Number(i.kmPorLitro);
      const l = Number(i.litros);
      if (isFinite(kml) && kml > 0 && isFinite(l) && l > 0) {
        return acc + kml * l;
      }
      return acc;
    }, 0);
    const consumoMedioFrota = somaLitros > 0 ? somaKm / somaLitros : null;

    return {
      totalGasto: Number(somaValor.toFixed(2)),
      litrosTotais: Number(somaLitros.toFixed(2)),
      precoMedio: Number(precoMedio.toFixed(4)),
      consumoMedioFrota: consumoMedioFrota != null ? Number(consumoMedioFrota.toFixed(3)) : null,
    };
  };

  const atual = calc(atualTodos);
  const anterior = calc(anteriorTodos);

  const delta = {
    totalGasto: Number((atual.totalGasto - anterior.totalGasto).toFixed(2)),
    precoMedio: Number((atual.precoMedio - anterior.precoMedio).toFixed(4)),
    consumoMedioFrota:
      atual.consumoMedioFrota != null && anterior.consumoMedioFrota != null
        ? Number((atual.consumoMedioFrota - anterior.consumoMedioFrota).toFixed(3))
        : null,
  };

  const avaliarAlvo = (precoMedio, alvo) => {
    if (!alvo || alvo <= 0) return { dentroAlvo: null, alvoValor: null };
    return { dentroAlvo: precoMedio <= alvo, alvoValor: alvo };
  };

  const alvo = {
    leve: avaliarAlvo(atual.precoMedio, alvoPrecoLeve),
    pesada: avaliarAlvo(atual.precoMedio, alvoPrecoPesada),
  };

  return {
    atual,
    anterior,
    delta,
    alvo,
    refAnterior: { mes: prevMes, ano: prevAno },
    abastecimentos: atualTodos,
  };
}

/** Agrupa por frota */
export function agruparPorFrota(items = []) {
  return items.reduce(
    (acc, i) => {
      if (i.tipoFrota === "leve") acc.leve.push(i);
      else if (i.tipoFrota === "pesada") acc.pesada.push(i);
      return acc;
    },
    { leve: [], pesada: [] }
  );
}

/* ===================== CONFIG (thresholds/alvos) ===================== */
export async function lerConfigAbastecimento() {
  const ref = doc(collection(db, CONFIG_COLLECTION), CONFIG_DOC_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return {
      alvoPrecoLeve: 0,
      alvoPrecoPesada: 0,
      updatedAt: null,
    };
  }
  const d = snap.data() || {};
  return {
    alvoPrecoLeve: Number(d.alvoPrecoLeve || 0),
    alvoPrecoPesada: Number(d.alvoPrecoPesada || 0),
    updatedAt: d.updatedAt || null,
  };
}

export async function salvarThreshold({ alvoPrecoLeve, alvoPrecoPesada } = {}) {
  const ref = doc(collection(db, CONFIG_COLLECTION), CONFIG_DOC_ID);
  const snap = await getDoc(ref);

  const patch = {
    ...(alvoPrecoLeve !== undefined ? { alvoPrecoLeve: Number(alvoPrecoLeve) } : {}),
    ...(alvoPrecoPesada !== undefined ? { alvoPrecoPesada: Number(alvoPrecoPesada) } : {}),
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    await setDoc(ref, patch);
  } else {
    await updateDoc(ref, patch);
  }

  const fresh = await getDoc(ref);
  const d = fresh.data() || {};
  return {
    alvoPrecoLeve: Number(d.alvoPrecoLeve || 0),
    alvoPrecoPesada: Number(d.alvoPrecoPesada || 0),
    updatedAt: d.updatedAt || null,
  };
}
