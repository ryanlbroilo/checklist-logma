const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const twilio = require("twilio");

admin.initializeApp();
const db = admin.firestore();

/* ================= Função loginByName ================= */
function normalizeName(name) {
  return (name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Memória simples para rate-limit leve
const attemptMap = new Map(); // key: ip+name -> {count, ts}

exports.loginByName = functions.https.onCall(async (data, context) => {
  if (!context.app) {
    throw new functions.https.HttpsError("failed-precondition", "App Check requerido.");
  }

  const ip = context.rawRequest.headers["x-forwarded-for"] || context.rawRequest.ip || "unknown";
  const name = normalizeName(data?.name);
  const password = String(data?.password || "");

  if (!name || !password) {
    throw new functions.https.HttpsError("invalid-argument", "Informe nome e senha.");
  }

  const key = `${ip}::${name}`;
  const now = Date.now();
  const rec = attemptMap.get(key) || { count: 0, ts: now };
  if (now - rec.ts > 10 * 60 * 1000) {
    rec.count = 0; rec.ts = now;
  }
  rec.count += 1;
  attemptMap.set(key, rec);
  if (rec.count > 10) {
    throw new functions.https.HttpsError("resource-exhausted", "Muitas tentativas. Tente novamente mais tarde.");
  }

  const snap = await db.collection("usuarios")
    .where("nomeNormalizado", "==", name)
    .limit(1)
    .get();

  if (snap.empty) {
    throw new functions.https.HttpsError("permission-denied", "Credenciais inválidas.");
  }

  const userDoc = snap.docs[0].data();
  const email = userDoc.email;
  if (!email) {
    throw new functions.https.HttpsError("failed-precondition", "Cadastro incompleto. Contate o administrador.");
  }

  const apiKey = functions.config().webapi.key;
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const json = await resp.json();
  if (!resp.ok) {
    rec.count += 1; attemptMap.set(key, rec);
    throw new functions.https.HttpsError("permission-denied", "Credenciais inválidas.");
  }

  const uid = json.localId;
  const customToken = await admin.auth().createCustomToken(uid, {
    login_method: "name+password"
  });

  return { token: customToken };
});

/* ================= Função enviarRelatorioWhatsApp ================= */
exports.enviarRelatorioWhatsApp = functions.pubsub
  .schedule("10 16 * * 5") // Sexta 16:10
  .timeZone("America/Sao_Paulo")
  .onRun(async () => {
    const inicioSemana = getSegundaDaSemana();
    const fimSemana = new Date();
    fimSemana.setHours(23, 59, 59, 999);

    const checklistsSnap = await db.collection("checklists")
      .where("dataHora", ">=", inicioSemana)
      .where("dataHora", "<=", fimSemana)
      .get();

    const abastecimentosSnap = await db.collection("abastecimentos")
      .where("data", ">=", inicioSemana)
      .where("data", "<=", fimSemana)
      .get();

    let problemasCount = 0;
    checklistsSnap.forEach(doc => {
      const data = doc.data();
      if (data.respostas) {
        Object.values(data.respostas).forEach(valor => {
          if (valor === "nok") problemasCount++;
        });
      }
    });

    const usuariosSnap = await db.collection("usuarios").get();
    const motoristas = usuariosSnap.docs
      .map(d => d.data())
      .filter(u => ["motorista", "operador_empilhadeira", "operador_gerador"].includes(u.role));

    const faltas = {};
    for (let d = new Date(inicioSemana); d <= fimSemana; d.setDate(d.getDate() + 1)) {
      for (const m of motoristas) {
        const fez = checklistsSnap.docs.some(c => {
          const cData = c.data();
          if (cData.usuarioNome !== m.nome) return false;
          let dt = cData.dataHora?.toDate?.() || cData.dataHora;
          if (dt?.seconds) dt = new Date(dt.seconds * 1000);
          return mesmoDia(dt, d);
        });
        if (!fez) {
          if (!faltas[m.nome]) faltas[m.nome] = [];
          faltas[m.nome].push(formatarData(d));
        }
      }
    }

    // Monta mensagem bonita
    let msg = `📊 *Relatório Semanal de Checklists*\n\n`;
    msg += `📝 Checklists preenchidos: *${checklistsSnap.size}*\n`;
    msg += `⛽ Abastecimentos registrados: *${abastecimentosSnap.size}*\n`;
    msg += `⚠️ Problemas encontrados: *${problemasCount}*\n\n`;

    if (Object.keys(faltas).length === 0) {
      msg += `✅ Todos os motoristas fizeram seus checklists esta semana.`;
    } else {
      msg += `🚨 Motoristas com faltas:\n`;
      for (const [nome, dias] of Object.entries(faltas)) {
        msg += `- *${nome}*: faltou em ${dias.join(", ")}\n`;
      }
    }

    await enviarWhatsApp(msg);
    console.log("Relatório enviado com sucesso!");
  });

/* ================= Helpers ================= */
function getSegundaDaSemana() {
  const hoje = new Date();
  const dia = hoje.getDay(); // 0=domingo
  const diff = hoje.getDate() - dia + (dia === 0 ? -6 : 1);
  const segunda = new Date(hoje.setDate(diff));
  segunda.setHours(0, 0, 0, 0);
  return segunda;
}

function mesmoDia(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatarData(d) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/* ================= Twilio ================= */
async function enviarWhatsApp(mensagem) {
  const accountSid = functions.config().twilio.sid;
  const authToken = functions.config().twilio.token;
  const client = twilio(accountSid, authToken);

  const from = "whatsapp:+14155238886"; // Twilio Sandbox
  const numeros = [
    "whatsapp:+555192895167",
    "whatsapp:+555189311759"
  ];

  for (const to of numeros) {
    await client.messages.create({ from, to, body: mensagem });
  }
}
