const functions = require("firebase-functions");
const admin = require("firebase-admin");
const twilio = require("twilio");

admin.initializeApp();
const db = admin.firestore();

/* ================= Twilio Setup ================= */
const accountSid = functions.config().twilio.sid; // SID da conta Twilio
const authToken = functions.config().twilio.token; // Auth Token
const whatsappFrom = "whatsapp:+14155238886"; // Número do Sandbox Twilio
const client = twilio(accountSid, authToken);

/* ================= Função loginByName ================= */
function normalizeName(name) {
  return (name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const attemptMap = new Map(); // key: ip+name -> {count, ts}

exports.loginByName = functions
  .region("southamerica-east1")
  .https.onCall(async (data, context) => {
    if (!context.app) throw new functions.https.HttpsError("failed-precondition", "App Check requerido.");

    const ip = context.rawRequest.headers["x-forwarded-for"] || context.rawRequest.ip || "unknown";
    const name = normalizeName(data?.name);
    const password = String(data?.password || "");

    if (!name || !password) throw new functions.https.HttpsError("invalid-argument", "Informe nome e senha.");

    const key = `${ip}::${name}`;
    const now = Date.now();
    const rec = attemptMap.get(key) || { count: 0, ts: now };
    if (now - rec.ts > 10 * 60 * 1000) rec.count = 0, rec.ts = now;
    rec.count += 1;
    attemptMap.set(key, rec);
    if (rec.count > 10) throw new functions.https.HttpsError("resource-exhausted", "Muitas tentativas. Tente novamente mais tarde.");

    const snap = await db.collection("usuarios")
      .where("nomeNormalizado", "==", name)
      .limit(1)
      .get();
    if (snap.empty) throw new functions.https.HttpsError("permission-denied", "Credenciais inválidas.");

    const userDoc = snap.docs[0].data();
    const email = userDoc.email;
    if (!email) throw new functions.https.HttpsError("failed-precondition", "Cadastro incompleto.");

    const apiKey = functions.config().webapi.key;
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const json = await resp.json();
    if (!resp.ok) { rec.count += 1; attemptMap.set(key, rec); throw new functions.https.HttpsError("permission-denied", "Credenciais inválidas."); }

    const uid = json.localId;
    const customToken = await admin.auth().createCustomToken(uid, { login_method: "name+password" });

    return { token: customToken };
  });

/* ================= Função enviarRelatorioWhatsApp ================= */
exports.enviarRelatorioWhatsApp = functions.pubsub
  .schedule("0 16 * * 5")
  .timeZone("America/Sao_Paulo")
  .onRun(async () => {
    const inicioSemana = getSegundaDaSemana();
    const fimSemana = new Date(); fimSemana.setHours(23, 59, 59, 999);

    const [checklistsSnap, abastecimentosSnap, usuariosSnap] = await Promise.all([
      db.collection("checklists").where("dataHora", ">=", inicioSemana).where("dataHora", "<=", fimSemana).get(),
      db.collection("abastecimentos").where("data", ">=", inicioSemana).where("data", "<=", fimSemana).get(),
      db.collection("usuarios").get()
    ]);

    let problemasCount = 0;
    checklistsSnap.forEach(doc => {
      const data = doc.data();
      if (data.respostas) Object.values(data.respostas).forEach(v => { if (v === "nok") problemasCount++; });
    });

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

    // Mensagem otimizada
    let msg = `📊 *Relatório Semanal da Frota*\n\n`;
    msg += `🚗 *Checklists preenchidos:* ${checklistsSnap.size}\n`;
    msg += `⛽ *Abastecimentos:* ${abastecimentosSnap.size}\n`;
    msg += `⚠️ *Problemas detectados:* ${problemasCount}\n\n`;

    if (Object.keys(faltas).length === 0) {
      msg += `✅ Todos os motoristas completaram seus checklists! 🎉`;
    } else {
      msg += `⚠️ *Motoristas com faltas:*\n`;
      for (const [nome, dias] of Object.entries(faltas)) {
        msg += `- ${nome}: faltou em ${dias.join(", ")}\n`;
      }
    }

    const destinatarios = [
      "whatsapp:+55NUMERO1",
      "whatsapp:+55NUMERO2",
      "whatsapp:+55NUMERO3"
    ];

    for (const to of destinatarios) {
      await client.messages.create({ from: whatsappFrom, to, body: msg });
    }

    console.log("Relatório enviado via Twilio Sandbox com sucesso!");
  });

/* ================= Helpers ================= */
function getSegundaDaSemana() {
  const hoje = new Date();
  const dia = hoje.getDay();
  const diff = hoje.getDate() - dia + (dia === 0 ? -6 : 1);
  const segunda = new Date(hoje.setDate(diff));
  segunda.setHours(0, 0, 0, 0);
  return segunda;
}

function mesmoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatarData(d) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
