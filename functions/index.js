const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();

function normalizeName(name) {
  return (name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Simples memória para rate-limit leve (melhor usar Firestore/Redis em prod)
const attemptMap = new Map(); // key: ip+name -> {count, ts}

exports.loginByName = functions
  .region("southamerica-east1") // ajuste pra tua região
  .https.onCall(async (data, context) => {
    // 1) App Check obrigatório
    if (!context.app) {
      throw new functions.https.HttpsError("failed-precondition", "App Check requerido.");
    }

    const ip = context.rawRequest.headers["x-forwarded-for"] || context.rawRequest.ip || "unknown";
    const name = normalizeName(data?.name);
    const password = String(data?.password || "");

    if (!name || !password) {
      throw new functions.https.HttpsError("invalid-argument", "Informe nome e senha.");
    }

    // 2) Rate-limit muito simples (ex.: 10 tentativas/10min por ip+nome)
    const key = `${ip}::${name}`;
    const now = Date.now();
    const rec = attemptMap.get(key) || { count: 0, ts: now };
    if (now - rec.ts > 10 * 60 * 1000) { // reseta janela a cada 10min
      rec.count = 0; rec.ts = now;
    }
    rec.count += 1;
    attemptMap.set(key, rec);
    if (rec.count > 10) {
      throw new functions.https.HttpsError("resource-exhausted", "Muitas tentativas. Tente novamente mais tarde.");
    }

    // 3) Busca o usuário por nome em /usuarios (apenas no servidor, Admin SDK ignora rules)
    const db = admin.firestore();
    const snap = await db.collection("usuarios")
      .where("nomeNormalizado", "==", name) // RECOMENDADO: manter esse campo denormalizado
      .limit(1)
      .get();

    if (snap.empty) {
      // não dar pistas se o nome existe; mensagem genérica
      throw new functions.https.HttpsError("permission-denied", "Credenciais inválidas.");
    }

    const userDoc = snap.docs[0].data();
    const email = userDoc.email;
    if (!email) {
      throw new functions.https.HttpsError("failed-precondition", "Cadastro incompleto. Contate o administrador.");
    }

    // 4) Verifica senha na API Identity Toolkit (Firebase Auth REST) do lado servidor
    // Crie a variável de ambiente: functions:config:set webapi.key="SUA_CHAVE_WEB"
    const apiKey = functions.config().webapi.key;
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const json = await resp.json();
    if (!resp.ok) {
      // incrementa penalidade (ex.: tentativa extra)
      rec.count += 1; attemptMap.set(key, rec);
      throw new functions.https.HttpsError("permission-denied", "Credenciais inválidas.");
    }

    // 5) Gera Custom Token para o UID retornado
    const uid = json.localId;
    const customToken = await admin.auth().createCustomToken(uid, {
      login_method: "name+password"
    });

    // 6) Retorna token (não retorna o e-mail)
    return { token: customToken };
  });
